// Sol assistant state machine, injected with Runtime.evaluate (an inline <script>
// would be blocked by the page CSP). The returned IIFE string is appended to the
// install payload in src/injector.mjs, so mounting the skin always rebuilds it.
//
// Contract: window.__ccsAssistant = {
//   state, setState(name), signals(), dispose(),
//   visible, setVisible(), toggle(),
//   pets, position, resetPosition(), say(text), react(name), greeted,
// }
//
// Only the current reply's rendered length is measured locally. No text is stored.
// Interactions (click / drag / hover / greeting / idle gestures) are optional and
// gated by `assistant.interactive` in config/skin.json.

import { mountSolActions } from './sol-actions.mjs';

const STATE_ANIMS = {
  idle: 'breathe',
  listening: 'breathe-fast',
  thinking: 'sway',
  done: 'bounce',
  smile: 'breathe-fast',
  error: 'shake',
  hug: 'breathe-fast',
};

export function assistantRuntime(config = {}) {
  const asst = config || {};
  const cfg = {
    doneMs: Number(asst.doneMs ?? 2500),
    smileMs: Number(asst.smileMs ?? 5000),
    quiescenceMs: Number(asst.quiescenceMs ?? 1200),
    captionMs: Number(asst.captionMs ?? 2600),
    idleMs: Number(asst.idleMs ?? 60000),
    greet: asst.greet !== false,
    sendLabel: asst.signals?.sendLabel || '发送',
    stopLabel: asst.signals?.stopLabel || '停止',
    states: Object.keys(asst.states || STATE_ANIMS),
    visible: asst.visible !== false,
    interactive: {
      enabled: asst.interactive?.enabled !== false,
      click: asst.interactive?.click !== false,
      drag: asst.interactive?.drag !== false,
      hover: asst.interactive?.hover !== false,
      idle: asst.interactive?.idle !== false,
    },
    lines: {
      greet: Array.isArray(asst.lines?.greet) ? asst.lines.greet : [],
      click: Array.isArray(asst.lines?.click) ? asst.lines.click : [],
      pet: asst.lines?.pet && typeof asst.lines.pet === 'object' ? asst.lines.pet : {},
    },
  };

  return `(() => {
  const prev = window.__ccsAssistant;
  try { if (prev && typeof prev.dispose === 'function') prev.dispose(); } catch (e) {}

  const root = document.getElementById('ccs-assistant');
  if (!root) return { ok: false, reason: 'assistant node missing' };

  const cfg = ${JSON.stringify(cfg)};
  const anims = ${JSON.stringify(STATE_ANIMS)};
  const canState = (name) => name === 'smile' || cfg.states.includes(name);

  const hit = root.querySelector('.ccs-sol-hit');
  const bodyImage = root.querySelector('.ccs-sol-body');
  const idleImage = bodyImage?.src;
  const poses = payload.solPoses || {};
  const html = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const focusActive = () => html.dataset.ccsFocus === 'on';
  const captionEl = root.querySelector('.ccs-sol-caption');
  const heartsEl = root.querySelector('.ccs-sol-hearts');
  const interactive = !!hit && cfg.interactive && cfg.interactive.enabled !== false;

  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) {}
    },
  };

  /* --- show / hide ------------------------------------------------------- */
  // The preference lives in localStorage so it survives reloads; the small glass
  // button (#ccs-sol-toggle) and the sprite hit area are the pointer-interactive
  // parts of the skin.
  const STORE_KEY = 'ccs-sol-visible';
  const toggleButton = () => document.getElementById('ccs-sol-toggle');
  let isVisible = (() => {
    const stored = store.get(STORE_KEY);
    return stored === null ? !!cfg.visible : stored === '1';
  })();

  const applyVisible = (next, persist) => {
    isVisible = !!next;
    document.documentElement.dataset.ccsSol = isVisible ? 'on' : 'off';
    const btn = toggleButton();
    if (btn) {
      const label = isVisible ? '隐藏 Sol' : '显示 Sol';
      btn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    if (persist) store.set(STORE_KEY, isVisible ? '1' : '0');
    if (!isVisible && persist) {
      actions?.close();
      clearFeedback();
    }
  };

  const onToggleClick = (e) => {
    const target = e.target;
    if (!target || !target.closest || !target.closest('#ccs-sol-toggle')) return;
    e.preventDefault();
    e.stopPropagation();
    applyVisible(!isVisible, true);
  };
  document.addEventListener('click', onToggleClick, true);
  applyVisible(isVisible, false);

  let state = 'idle';
  let timers = [];
  let turn = null;
  // Manual setState() (debug tools / demos) must not be overridden by the poller,
  // otherwise a "thinking" demo would instantly be judged as a failed submit.
  let manualUntil = 0;
  // Interaction bookkeeping (all local).
  let lastActivityAt = Date.now();
  let lastIdleAt = 0;
  let reactTimer = null;
  let captionTimer = null;
  let heartsTimer = null;
  let poseTimer = null;
  let nextBlinkAt = Date.now() + 8000;
  let automaticPose = false;
  let resizeTimer = null;
  let panelObserver = null;
  let drag = null;
  let dragged = false;
  let pos = null;
  let pets = Number(store.get('ccs-sol-pets') || '0') || 0;

  const clearTimers = () => {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    delete root.dataset.ccsIdle;
  };
  const later = (ms, fn) => {
    timers.push(setTimeout(fn, ms));
  };

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };

  const textbox = () => {
    const all = Array.from(
      document.querySelectorAll('[role="textbox"][contenteditable="true"], textarea[role="textbox"], [role="textbox"]'),
    );
    // The app keeps a hidden off-screen composer for another view; only the
    // visible one receives typing.
    return all.find((el) => visible(el)) || null;
  };

  const boxText = () => {
    const el = textbox();
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    return el.textContent || '';
  };

  const composer = () => textbox()?.closest('form, [class*="ComposerLayoutBody"]');
  const sendButton = () => Array.from(composer()?.querySelectorAll('button') || []).find((button) =>
    visible(button) && (button.type === 'submit' ||
      [cfg.sendLabel, '发送', 'Send', 'Send message'].includes(button.getAttribute('aria-label')))) || null;

  const stopButton = () => {
    const labels = [cfg.stopLabel, '停止', '停止生成', 'Stop', 'Stop generating', 'Stop response'];
    return Array.from(composer()?.querySelectorAll('button') || []).find((button) =>
      visible(button) && (button.dataset.testid === 'stop-button' ||
        labels.includes(button.getAttribute('aria-label')?.trim()))) || null;
  };

  const assistantSelector = '[data-message-author-role="assistant"]';
  const userSelector = '[data-message-author-role="user"]';
  const markdownSelector = '[class*="MarkdownRoot"]';
  const chatNodes = (selector) => Array.from(document.getElementById('root')?.querySelectorAll(selector) || []);
  const messageKey = (node) => node.closest('[data-message-id]')?.getAttribute('data-message-id') || node;
  const keys = (nodes) => new Set(nodes.map(messageKey));

  const applyAnim = (name) => {
    root.dataset.ccsAnim = anims[name] || 'breathe';
  };

  const setState = (name) => {
    const next = canState(name) ? name : 'idle';
    if (next === state) return state;
    state = next;
    root.dataset.ccsState = next;
    applyAnim(next);
    if (next === 'thinking') {
      clearFeedback();
      actions?.close();
      setPose('think', 0, true);
    } else if (root.dataset.ccsPose === 'think') {
      setPose();
    }
    return state;
  };

  const settle = () => {
    turn = null;
    clearTimers();
    setState('idle');
  };

  const celebrate = () => {
    turn = null;
    clearTimers();
    setState('done');
    later(cfg.doneMs, () => {
      setState('smile');
      later(cfg.smileMs, settle);
    });
  };

  const touch = () => {
    lastActivityAt = Date.now();
  };

  /* --- lines / reactions ------------------------------------------------ */
  const pick = (list) => (list && list.length ? list[Math.floor(Math.random() * list.length)] : '');

  const say = (text, ms) => {
    if (!captionEl || !text) return false;
    captionEl.textContent = String(text);
    captionEl.hidden = false;
    // Force a reflow so the transition runs on every new line.
    void captionEl.offsetWidth;
    captionEl.classList.add('is-on');
    if (captionTimer) clearTimeout(captionTimer);
    const hold = Number(ms) || cfg.captionMs;
    captionTimer = setTimeout(() => {
      captionEl.classList.remove('is-on');
      captionTimer = setTimeout(() => {
        captionEl.hidden = true;
        captionTimer = null;
      }, 220);
    }, hold);
    return true;
  };

  const react = (name, ms) => {
    const next = cfg.states.includes(name) ? name : 'done';
    root.dataset.ccsReact = next;
    if (reactTimer) clearTimeout(reactTimer);
    reactTimer = setTimeout(() => {
      delete root.dataset.ccsReact;
      reactTimer = null;
    }, Number(ms) || 1200);
    return next;
  };

  function setPose(name, duration = 0, automatic = false) {
    if (!bodyImage || cfg.interactive.enabled === false || root.dataset.ccsMode !== 'bubble') return;
    clearTimeout(poseTimer);
    automaticPose = Boolean(name && automatic);
    if (name && poses[name] && !(automatic && focusActive())) {
      if (bodyImage.src !== poses[name]) bodyImage.src = poses[name];
      root.dataset.ccsPose = name;
      if (duration) poseTimer = setTimeout(() => setPose(), duration);
    } else {
      if (bodyImage.src !== idleImage) bodyImage.src = idleImage;
      delete root.dataset.ccsPose;
    }
  }

  function clearFeedback() {
    clearTimeout(reactTimer);
    clearTimeout(captionTimer);
    clearTimeout(heartsTimer);
    delete root.dataset.ccsReact;
    if (captionEl) {
      captionEl.classList.remove('is-on');
      captionEl.hidden = true;
    }
    heartsEl?.classList.remove('is-on');
    setPose();
  }

  const hearts = () => {
    if (!heartsEl) return false;
    heartsEl.classList.add('is-on');
    if (heartsTimer) clearTimeout(heartsTimer);
    heartsTimer = setTimeout(() => {
      heartsEl.classList.remove('is-on');
      heartsTimer = null;
    }, 1300);
    return true;
  };

  const petLine = () => {
    const table = cfg.lines.pet || {};
    return table[String(pets)] || '';
  };
  const actions = interactive && cfg.interactive.click !== false ? (${mountSolActions.toString()})(root, {
    canAct: () => isVisible && state !== 'thinking' && root.dataset.ccsShifted !== 'on',
    toPose: setPose,
    feedback: (line, sticker) => { say(line); react(sticker, 1650); },
    onPet: () => {
      pets += 1;
      store.set('ccs-sol-pets', String(pets));
      hearts();
      return petLine();
    },
    onTouch: touch,
    clickLines: cfg.lines.click,
  }) : null;

  /* --- position (drag / reset) ----------------------------------------- */
  const clampPos = (p) => {
    const r = root.getBoundingClientRect();
    const sidebar = document.getElementById('app-shell-sidebar')?.getBoundingClientRect();
    const navEdge = sidebar && sidebar.width > 4 ? sidebar.right : 0;
    const composerTop = composer()?.getBoundingClientRect().top ?? window.innerHeight - 72;
    const minBottom = Math.max(8, Math.round(window.innerHeight - composerTop + 12));
    const maxRight = Math.max(8, window.innerWidth - r.width - navEdge - 8);
    const maxBottom = Math.max(8, window.innerHeight - r.height - 8);
    return {
      right: Math.min(Math.max(8, Math.round(p.right)), Math.round(maxRight)),
      bottom: Math.min(Math.max(minBottom, Math.round(p.bottom)), Math.round(maxBottom)),
    };
  };

  const applyPos = () => {
    if (!pos) {
      root.style.right = '';
      root.style.bottom = '';
      return;
    }
    root.style.right = pos.right + 'px';
    root.style.bottom = pos.bottom + 'px';
  };

  const loadPos = () => {
    const raw = store.get('ccs-sol-pos');
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      if (p && typeof p.right === 'number' && typeof p.bottom === 'number') {
        pos = clampPos(p);
        applyPos();
      }
    } catch (e) {}
  };

  const resetPosition = () => {
    pos = null;
    applyPos();
    store.del('ccs-sol-pos');
    return null;
  };

  /* --- interactions ------------------------------------------------------ */
  const onPointerDown = (e) => {
    if (!interactive || cfg.interactive.drag === false || e.button !== 0) return;
    const r = root.getBoundingClientRect();
    drag = {
      x: e.clientX,
      y: e.clientY,
      right: window.innerWidth - r.right,
      bottom: window.innerHeight - r.bottom,
      moved: false,
    };
    try { hit.setPointerCapture(e.pointerId); } catch (err) {}
    root.dataset.ccsHover = 'grabbing';
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    pos = clampPos({ right: drag.right - dx, bottom: drag.bottom - dy });
    applyPos();
  };

  const onPointerUp = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    root.dataset.ccsHover = 'on';
    dragged = moved;
    if (moved && pos) {
      store.set('ccs-sol-pos', JSON.stringify(pos));
      touch();
    }
  };

  const onHitClick = (e) => {
    if (drag) return;
    e.preventDefault();
    e.stopPropagation();
    touch();
    if (dragged) {
      dragged = false;
      return;
    }
    actions?.act('pet', true);
  };

  const onHitDoubleClick = (e) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    resetPosition();
    say('回到原位啦', 1600);
  };

  const onEnter = () => {
    if (!interactive || cfg.interactive.hover === false || focusActive() || reducedMotion.matches) return;
    root.dataset.ccsHover = 'on';
    touch();
  };

  const onLeave = () => {
    if (drag) return;
    delete root.dataset.ccsHover;
  };

  if (hit) {
    hit.addEventListener('pointerdown', onPointerDown);
    hit.addEventListener('pointermove', onPointerMove);
    hit.addEventListener('pointerup', onPointerUp);
    hit.addEventListener('pointercancel', onPointerUp);
    hit.addEventListener('click', onHitClick);
    hit.addEventListener('dblclick', onHitDoubleClick);
    hit.addEventListener('pointerenter', onEnter);
    hit.addEventListener('pointerleave', onLeave);
    loadPos();
  }

  /* --- greeting ---------------------------------------------------------- */
  const greetLine = () => {
    const lines = cfg.lines.greet;
    if (!lines.length) return '';
    const h = new Date().getHours();
    const idx = h >= 5 && h < 11 ? 0 : h >= 11 && h < 18 ? 1 : h >= 18 && h < 23 ? 2 : 3;
    return lines[Math.min(idx, lines.length - 1)] || '';
  };

  const shouldGreet = () => {
    if (cfg.greet === false) return false;
    try { return sessionStorage.getItem('ccs-sol-greeted') !== '1'; } catch (e) { return false; }
  };

  if (interactive && !focusActive() && shouldGreet()) {
    const line = greetLine();
    if (line) say(line, 3200);
    try { sessionStorage.setItem('ccs-sol-greeted', '1'); } catch (e) {}
  }

  /* --- background panel hand-off ---------------------------------------- */
  // The picker is injected by the background runtime, which may mount after this
  // one, so the observer is attached lazily (also re-checked in tick()).
  const syncShift = () => {
    const p = document.getElementById('ccs-bg-panel');
    root.dataset.ccsShifted = p && !p.hidden ? 'on' : 'off';
    if (root.dataset.ccsShifted === 'on') actions?.close();
  };
  const ensurePanelObserver = () => {
    const p = document.getElementById('ccs-bg-panel');
    if (!p || panelObserver || !('MutationObserver' in window)) return;
    panelObserver = new MutationObserver(syncShift);
    panelObserver.observe(p, { attributes: true, attributeFilter: ['hidden', 'class'] });
    syncShift();
  };
  ensurePanelObserver();

  /* --- window resize keeps her inside ----------------------------------- */
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!pos) return;
      pos = clampPos(pos);
      applyPos();
      store.set('ccs-sol-pos', JSON.stringify(pos));
    }, 150);
  };
  window.addEventListener('resize', onResize);

  const onVisibility = () => {
    if (document.visibilityState === 'visible') touch();
    else actions?.close();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const syncDraft = () => {
    if (turn || (state !== 'idle' && state !== 'listening')) return;
    setState(boxText().trim() ? 'listening' : 'idle');
  };

  const onInput = (event) => {
    if (!textbox()?.contains(event.target)) return;
    touch();
    syncDraft();
  };

  const startTurn = () => {
    if (!isVisible || turn) return;
    touch();
    manualUntil = 0;
    const now = Date.now();
    const replies = chatNodes(assistantSelector);
    const users = chatNodes(userSelector);
    const markdown = chatNodes(markdownSelector);
    turn = {
      href: location.href,
      empty: !replies.length && !users.length && !markdown.length,
      replies: keys(replies),
      users: keys(users),
      markdown: keys(markdown),
      anchor: replies.at(-1) || users.at(-1) || markdown.at(-1),
      startedAt: now,
      changedAt: now,
      sawStop: false,
      stopEnded: false,
      reply: null,
      length: 0,
    };
    clearTimers();
    setState('thinking');
  };

  const trackTurn = (now) => {
    const stop = stopButton();
    const { anchor } = turn;
    if (turn.href !== location.href) {
      // An empty chat can acquire its conversation URL after the first send.
      if (!turn.empty || (turn.sawStop && !stop)) { settle(); return; }
      turn.href = location.href;
      turn.empty = false;
    } else if (anchor && !anchor.isConnected) {
      const nodes = chatNodes(assistantSelector + ', ' + userSelector + ', ' + markdownSelector);
      if (!nodes.some((node) => messageKey(node) === messageKey(anchor))) { settle(); return; }
    }

    const user = chatNodes(userSelector).find((node) => !turn.users.has(messageKey(node)));
    const afterUser = (node) => !user || !!(user.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    const reply = chatNodes(assistantSelector).find((node) => !turn.replies.has(messageKey(node)) && afterUser(node));
    if (stop && !turn.sawStop) {
      turn.sawStop = true;
      // Older renderers only expose MarkdownRoot. Exclude blocks already present
      // when generation starts so the just-sent prompt cannot count as a reply.
      chatNodes(markdownSelector).forEach((node) => turn.markdown.add(messageKey(node)));
    }
    const fallback = !reply && turn.sawStop && chatNodes(markdownSelector).find((node) =>
      !turn.markdown.has(messageKey(node)) && !node.closest(userSelector) && afterUser(node));
    const current = reply || fallback || null;
    const length = current?.textContent?.trim().length || 0;
    if (current !== turn.reply || length !== turn.length) {
      turn.reply = current;
      turn.length = length;
      turn.changedAt = now;
    }
    if (stop) return;
    if (turn.sawStop && !turn.stopEnded) {
      turn.stopEnded = true;
      turn.changedAt = now;
    }
    const quietMs = now - turn.changedAt;
    const waitMs = cfg.quiescenceMs * (turn.sawStop ? 1 : 2);
    if ((turn.sawStop || user) && length && quietMs >= waitMs) {
      celebrate();
    } else if ((turn.stopEnded && !length && quietMs >= waitMs) || now - turn.startedAt >= 60000) {
      settle();
    }
  };

  const tick = () => {
    if (document.visibilityState !== 'visible') return;
    if (!isVisible) { if (turn) settle(); return; }
    const now = Date.now();
    if (manualUntil) {
      if (now < manualUntil) return;
      manualUntil = 0;
      settle();
    }
    if (!panelObserver) ensurePanelObserver();
    if (automaticPose && focusActive()) setPose();
    if (state === 'thinking' && !focusActive() && root.dataset.ccsPose !== 'think') setPose('think', 0, true);
    if (turn) {
      trackTurn(now);
      return;
    }
    syncDraft();
    if (interactive && cfg.interactive.idle !== false && state === 'idle' && !focusActive() &&
        !reducedMotion.matches && !root.dataset.ccsReact && !root.dataset.ccsPose) {
      if (now - lastActivityAt > cfg.idleMs && now - lastIdleAt > 30000) {
        lastIdleAt = now;
        setPose('stretch', 1900, true);
      } else if (now >= nextBlinkAt) {
        nextBlinkAt = now + 8000 + Math.random() * 9000;
        setPose('blink', 240, true);
      }
    }
  };

  const onSubmit = (event) => {
    if (textbox()?.closest('form') === event.target && !stopButton()) startTurn();
  };
  const onComposerClick = (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (turn && button === stopButton()) { settle(); return; }
    if (button === sendButton() && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !stopButton()) startTurn();
  };
  const onKeydown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
        event.isComposing || event.keyCode === 229 || event.repeat || !textbox()?.contains(event.target)) return;
    const send = sendButton();
    if (boxText().trim() && !send?.disabled && send?.getAttribute('aria-disabled') !== 'true' && !stopButton()) startTurn();
  };

  document.addEventListener('input', onInput, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('click', onComposerClick, true);
  document.addEventListener('keydown', onKeydown, true);
  const poll = setInterval(tick, 400);
  setState('idle');

  const api = {
    get state() {
      return state;
    },
    get visible() {
      return isVisible;
    },
    get pets() {
      return pets;
    },
    get position() {
      return pos ? { right: pos.right, bottom: pos.bottom } : null;
    },
    get greeted() {
      try { return sessionStorage.getItem('ccs-sol-greeted') === '1'; } catch (e) { return false; }
    },
    get interactive() {
      return interactive;
    },
    setVisible(next) {
      applyVisible(next, true);
      return isVisible;
    },
    toggle() {
      applyVisible(!isVisible, true);
      return isVisible;
    },
    setState(name) {
      clearTimers();
      turn = null;
      manualUntil = Date.now() + 20000;
      return setState(name);
    },
    say(text, ms) {
      return say(text, ms);
    },
    react(name, ms) {
      return react(name, ms);
    },
    act(name) { return actions?.act(name) ?? false; },
    resetPosition,
    signals() {
      const send = sendButton();
      return {
        state,
        visible: isVisible,
        hidden: document.visibilityState,
        boxChars: boxText().trim().length,
        sendDisabled: send ? send.disabled : null,
        stop: !!stopButton(),
        mainChars: turn?.length || 0,
        sawStop: !!turn?.sawStop,
        interactive,
        pets,
        shifted: root.dataset.ccsShifted || 'off',
        caption: captionEl && !captionEl.hidden ? (captionEl.textContent || '') : '',
      };
    },
    dispose() {
      clearTimers();
      actions?.dispose();
      clearFeedback();
      if (reactTimer) clearTimeout(reactTimer);
      if (captionTimer) clearTimeout(captionTimer);
      if (heartsTimer) clearTimeout(heartsTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (hit) {
        hit.removeEventListener('pointerdown', onPointerDown);
        hit.removeEventListener('pointermove', onPointerMove);
        hit.removeEventListener('pointerup', onPointerUp);
        hit.removeEventListener('pointercancel', onPointerUp);
        hit.removeEventListener('click', onHitClick);
        hit.removeEventListener('dblclick', onHitDoubleClick);
        hit.removeEventListener('pointerenter', onEnter);
        hit.removeEventListener('pointerleave', onLeave);
      }
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('click', onComposerClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onToggleClick, true);
      if (panelObserver) panelObserver.disconnect();
      clearInterval(poll);
      panelObserver = null;
      delete window.__ccsAssistant;
    },
  };

  window.__ccsAssistant = api;
  return { ok: true, state, pets };
})();`;
}
