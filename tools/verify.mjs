// Acceptance check for the mounted skin.
//   node tools/verify.mjs                 # run all checks
//   node tools/verify.mjs --shot shots/verify.png
// Exits 0 when everything passes, 1 otherwise.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget, probeVersion } from '../src/cdp.mjs';
import { PROJECT_ROOT, loadConfig } from '../src/assets.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt('port', DEFAULT_PORT));
const shot = opt('shot', '');
const config = loadConfig(PROJECT_ROOT);

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const hex = (c) => String(c || '').trim().toLowerCase();
const alphaOf = (c) => {
  const m = String(c || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(',').map((s) => s.trim());
  return parts.length > 3 ? Number(parts[3]) : 1;
};

const version = await probeVersion(port).catch(() => null);
check('DevTools endpoint reachable', !!version, version ? `${version.Browser} @ 127.0.0.1:${port}` : `nothing on 127.0.0.1:${port}`);
if (!version) process.exit(1);

const target = await findShellTarget(port, {});
check('ChatGPT main window target found', !!target, target ? target.url : 'no shell target');
if (!target) process.exit(1);

const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const state = await cdp.evaluate(`(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const pick = (n) => cs.getPropertyValue(n).trim();
  const back = document.getElementById('ccs-skin-layers');
  const front = document.getElementById('ccs-skin-front');
  const style = document.getElementById('ccs-skin-style');
  const rootDiv = document.querySelector('#root > div');
  return {
    ready: document.readyState,
    visibility: document.visibilityState,
    href: location.href,
    marker: root.dataset.ccsSkin || null,
    labStyle: !!document.getElementById('ccs-lab'),
    styleBytes: style ? style.textContent.length : 0,
    backChildren: back ? Array.from(back.children).map((n) => n.className) : [],
    frontChildren: front ? Array.from(front.children).map((n) => n.className) : [],
    layersPe: back ? getComputedStyle(back).pointerEvents : null,
    frontPe: front ? getComputedStyle(front).pointerEvents : null,
    layersZ: back ? getComputedStyle(back).zIndex : null,
    rootZ: document.getElementById('root') ? getComputedStyle(document.getElementById('root')).zIndex : null,
    surface: pick('--app-color-background-surface'),
    mainSurface: pick('--color-token-main-surface-primary'),
    sidebar: pick('--color-token-side-bar-background'),
    accent: pick('--codex-theme-accent-color'),
    ink: pick('--color-text-primary'),
    focusing: root.dataset.ccsFocus === 'on',
    bgOpacity: pick('--ccs-bg-opacity'),
    pane: (() => {
      const main = document.querySelector('#root main');
      const panes = Array.from(document.querySelectorAll(
        '#root :is(webview, [data-browser-sidebar-primary-focus-target], [data-browser-sidebar-chrome-expanded])'));
      const visible = panes.filter((w) => {
        const cs = getComputedStyle(w);
        const r = w.getBoundingClientRect();
        return !w.closest('[hidden]') && (w.tagName !== 'WEBVIEW' || !w.closest('[inert], [aria-hidden="true"]')) &&
          cs.opacity !== '0' && cs.visibility === 'visible' && r.width >= 8 && r.height >= 8 &&
          r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      });
      return {
        flag: root.dataset.ccsPane || null,
        kind: root.dataset.ccsPaneKind || null,
        safe: root.dataset.ccsSafe || null,
        live: visible.length,
        mainRadius: main ? getComputedStyle(main).borderRadius : null,
        layersHidden: !!back && !!front && getComputedStyle(back).display === 'none' &&
          getComputedStyle(front).display === 'none',
      };
    })(),
    sol: (() => {
      const el = document.getElementById('ccs-assistant');
      const toggle = document.getElementById('ccs-sol-toggle');
      const root = document.documentElement;
      if (!el) return { present: false, toggle: !!toggle };
      return {
        present: true,
        state: el.dataset.ccsState || null,
        mode: el.dataset.ccsMode || null,
        anim: el.dataset.ccsAnim || null,
        pe: getComputedStyle(el).pointerEvents,
        visibility: getComputedStyle(el).visibility,
        emotes: Array.from(el.querySelectorAll('.ccs-sol-emote')).map((n) => n.dataset.state),
        body: !!el.querySelector('.ccs-sol-body'),
        dots: !!el.querySelector('.ccs-sol-dots'),
        toggle: !!toggle,
        togglePe: toggle ? getComputedStyle(toggle).pointerEvents : null,
        togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        rootFlag: root.dataset.ccsSol || null,
        hit: !!el.querySelector('.ccs-sol-hit'),
        hitPe: el.querySelector('.ccs-sol-hit') ? getComputedStyle(el.querySelector('.ccs-sol-hit')).pointerEvents : null,
        hitRatio: (() => {
          const hit = el.querySelector('.ccs-sol-hit');
          const body = el.querySelector('.ccs-sol-body');
          if (!hit || !body) return null;
          const h = hit.getBoundingClientRect();
          const b = body.getBoundingClientRect();
          return b.height ? Math.round((h.height / b.height) * 100) / 100 : null;
        })(),
        caption: !!el.querySelector('.ccs-sol-caption'),
        hearts: !!el.querySelector('.ccs-sol-hearts'),
        interactive: el.dataset.ccsInteractive || null,
        shifted: el.dataset.ccsShifted || null,
        pets: window.__ccsAssistant ? window.__ccsAssistant.pets : null,
      };
    })(),
    bg: (() => {
      const api = window.__ccsBackground;
      const toggle = document.getElementById('ccs-bg-toggle');
      const panel = document.getElementById('ccs-bg-panel');
      const items = panel ? Array.from(panel.querySelectorAll('.ccs-bg-item')) : [];
      const bgEl = document.querySelector('#ccs-skin-layers .ccs-bg');
      return {
        api: !!api,
        state: api ? api.state : null,
        toggle: !!toggle,
        togglePe: toggle ? getComputedStyle(toggle).pointerEvents : null,
        panel: !!panel,
        panelHidden: panel ? panel.hidden : null,
        items: items.length,
        dynamicItems: panel?.querySelectorAll('#ccs-bg-page-dynamic [data-source="dynamic"]').length || 0,
        inAppImport: !!panel?.querySelector('#ccs-bg-page-static input[type="file"]'),
        activeIndex: items.findIndex((el) => el.classList.contains('is-active')),
        names: items.map((el) => {
          const n = el.querySelector('.ccs-bg-name');
          return n ? n.textContent.trim() : '';
        }),
        image: bgEl ? String(bgEl.style.backgroundImage || '').slice(0, 64) : '',
      };
    })(),
  };
})()`);

check('renderer finished loading', state.ready === 'complete', state.ready);
check('window is visible (screenshots possible)', state.visibility === 'visible', state.visibility);
check('skin marker present on <html>', state.marker === (config.marker || 'mint'), `marker=${state.marker}`);
check('skin stylesheet mounted', state.styleBytes > 1000, `${state.styleBytes}B`);
check('no leftover lab stylesheet', !state.labStyle, state.labStyle ? '#ccs-lab still in DOM' : 'clean');

const wantBack = 1 + (config.characters || []).filter((c) => c.enabled !== false && (c.layer || 'back') === 'back').length;
check('background + back characters mounted', state.backChildren.length === wantBack, `${state.backChildren.join(', ')}`);

const wantFront = (config.chibi && config.chibi.enabled !== false ? 1 : 0) +
  (config.assistant?.enabled ? 1 : 0) +
  (config.assistant?.enabled && config.assistant?.controls !== false ? 1 : 0) +
  (config.background?.picker !== false && state.bg.api ? 2 : 0) +
  (config.characters || []).filter((c) => c.enabled !== false && c.layer === 'front').length;
check('foreground layer mounted', state.frontChildren.length === wantFront, `${state.frontChildren.join(', ') || 'empty'}`);

check('decoration layers ignore input', state.layersPe === 'none' && state.frontPe === 'none', `${state.layersPe}/${state.frontPe}`);
const nativeMode = state.pane.flag === 'on' || state.pane.safe === 'on';
check('browser pane follows window visibility', (state.pane.flag === 'on') === (state.pane.live > 0), state.pane.kind);
if (nativeMode) {
  check('browser can use the native renderer without skin layers', state.pane.layersHidden);
} else {
  check('app shell stacked above artwork', Number(state.rootZ) > Number(state.layersZ || 0));
  check('chat surface matches the selected preset', state.focusing ? alphaOf(state.surface) === 1 : alphaOf(state.surface) < 1, state.surface);
  check('main surface token overridden', state.mainSurface !== '' && state.mainSurface !== 'rgb(255, 255, 255)', state.mainSurface);
  check('sidebar token overridden', state.sidebar !== '', state.sidebar.slice(0, 60));
  const expectedAccent = state.focusing ? '#286b50' : config.palette.accent;
  const expectedInk = state.focusing ? '#182b23' : config.palette.ink;
  check('accent uses selected palette', hex(state.accent) === hex(expectedAccent), state.accent);
  check('ink uses selected palette', hex(state.ink) === hex(expectedInk), state.ink);
  check('chat canvas stays rounded', parseFloat(state.pane.mainRadius) > 0, state.pane.mainRadius);
}

const asstCfg = config.assistant || {};
const asstStates = Object.keys(asstCfg.states || {});
const allowedStates = [...asstStates, 'smile'];
const animFor = (s) => asstCfg.states?.[s]?.animation || (s === 'smile' ? 'breathe-fast' : null);
if (asstCfg.enabled) {
  check('Sol assistant mounted', state.sol.present, state.sol.present ? `state=${state.sol.state} mode=${state.sol.mode}` : 'missing #ccs-assistant');
  check('Sol container ignores input', state.sol.pe === 'none', state.sol.pe);
  const interacting = asstCfg.interactive?.enabled !== false && asstCfg.interactive?.click !== false;
  if (interacting && !nativeMode) {
    check('Sol click target mounted', state.sol.hit, state.sol.hit ? `covers ${Math.round((state.sol.hitRatio || 0) * 100)}% of body` : 'missing .ccs-sol-hit');
    check('Sol click target is interactive', state.sol.hitPe === 'auto', String(state.sol.hitPe));
    check('Sol click target covers most of the sprite', (state.sol.hitRatio || 0) >= 0.6, String(state.sol.hitRatio));
    check('Sol caption node present', state.sol.caption, state.sol.caption ? 'ok' : 'missing .ccs-sol-caption');
    check('Sol hearts node present', state.sol.hearts, state.sol.hearts ? 'ok' : 'missing .ccs-sol-hearts');
    check('Sol interactive flag is on', state.sol.interactive === 'on', `data-ccs-interactive=${state.sol.interactive}`);
  }
  check('Sol state is a configured state', allowedStates.includes(state.sol.state), `${state.sol.state} in [${allowedStates.join(', ')}]`);
  check('Sol animation matches state', state.sol.anim === animFor(state.sol.state), `${state.sol.anim}`);
  check('Sol emotes match configuration', state.sol.emotes.length === asstStates.length, `${state.sol.emotes.join(', ')}`);
  if ((asstCfg.mode || 'bubble') === 'bubble') check('Sol body sprite present', state.sol.body, asstCfg.body);
  check('Sol thinking dots present', state.sol.dots, state.sol.dots ? 'ok' : 'missing');
  if (asstCfg.controls !== false) {
    check('Sol visibility toggle present', state.sol.toggle, state.sol.toggle ? 'ok' : 'missing #ccs-sol-toggle');
    check('Sol toggle is clickable', state.sol.togglePe === 'auto', String(state.sol.togglePe));
    check('Sol toggle state is valid', ['true', 'false'].includes(String(state.sol.togglePressed)), `aria-pressed=${state.sol.togglePressed}`);
  }
  const hidden = state.sol.rootFlag === 'off';
  check(
    'Sol visibility flag matches rendering',
    ['on', 'off', null].includes(state.sol.rootFlag) && (!hidden || state.sol.visibility === 'hidden'),
    `html[data-ccs-sol]=${state.sol.rootFlag}, visibility=${state.sol.visibility}`,
  );

  if (interacting && !nativeMode) {
    const live = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const api = window.__ccsAssistant;
      const el = document.getElementById('ccs-assistant');
      const hit = el && el.querySelector('.ccs-sol-hit');
      if (!api || !hit) return { ok: false, reason: 'no runtime or hit area' };
      const before = api.pets;
      const r = hit.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const send = (type, target, extra) => target.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 99, pointerType: 'mouse', button: 0,
      }, extra)));
      send('pointerdown', hit, { buttons: 1 });
      send('pointerup', hit, { buttons: 0 });
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      const caption = el.querySelector('.ccs-sol-caption');
      const afterClick = {
        pets: api.pets,
        caption: caption ? caption.textContent.trim() : '',
        react: el.dataset.ccsReact || null,
      };

      const startPos = JSON.stringify(api.position);
      send('pointerdown', hit, { buttons: 1 });
      for (let i = 1; i <= 4; i++) {
        hit.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, clientX: x - i * 40, clientY: y - i * 12, pointerId: 99, pointerType: 'mouse', buttons: 1,
        }));
      }
      send('pointerup', hit, { buttons: 0, clientX: x - 160, clientY: y - 48 });
      const afterDrag = { pos: api.position, stored: localStorage.getItem('ccs-sol-pos') };
      api.resetPosition();
      const afterReset = { pos: api.position, stored: localStorage.getItem('ccs-sol-pos') };

      const toggle = document.getElementById('ccs-bg-toggle');
      const panel = document.getElementById('ccs-bg-panel');
      let shiftOpen = null;
      let shiftClosed = null;
      if (toggle && panel) {
        if (panel.hidden) toggle.click();
        await wait(160);
        shiftOpen = el.dataset.ccsShifted || null;
        if (!panel.hidden) toggle.click();
        await wait(160);
        shiftClosed = el.dataset.ccsShifted || null;
      }
      return { ok: true, before, afterClick, startPos, afterDrag, afterReset, shiftOpen, shiftClosed };
    })()`);
    check('Sol click responds with a line', live.ok && live.afterClick.caption.length > 0, live.ok ? live.afterClick.caption : live.reason);
    check('Sol click increments petting counter', live.ok && live.afterClick.pets === live.before + 1, live.ok ? `${live.before} -> ${live.afterClick.pets}` : live.reason);
    check('Sol dragging moves and persists position', live.ok && !!live.afterDrag.stored && live.afterDrag.pos && live.afterDrag.stored.includes('right'), live.ok ? live.afterDrag.stored || 'not stored' : live.reason);
    check('Sol position resets back', live.ok && !live.afterReset.stored, live.ok ? `pos=${JSON.stringify(live.afterReset.pos)}` : live.reason);
    check('Sol steps aside for the picker', live.ok && live.shiftOpen === 'on' && live.shiftClosed !== 'on', live.ok ? `open=${live.shiftOpen} closed=${live.shiftClosed}` : live.reason);
  }
} else {
  check('Sol assistant disabled', !state.sol.present, state.sol.present ? 'node still mounted' : 'absent');
}

const bgCfg = config.background || {};
if (bgCfg.picker !== false && state.bg.api) {
  const names = state.bg.names;
  const unique = new Set(names);
  check('background library mounted', state.bg.api && names.length > 0, `${names.length} items`);
  check('background names are present and unique', names.every((n) => n.length > 0) && unique.size === names.length, `${unique.size}/${names.length} distinct`);
  check('background toggle present', state.bg.toggle, state.bg.toggle ? 'ok' : 'missing #ccs-bg-toggle');
  check('background toggle is clickable', state.bg.togglePe === 'auto', String(state.bg.togglePe));
  check('background panel lists every wallpaper', state.bg.panel && state.bg.items === names.length, `${state.bg.items}/${names.length}`);
  const builtIn = state.bg.state.source === 'static';
  check('background selection is highlighted', state.bg.activeIndex === (builtIn ? state.bg.state.index : -1),
    `active=${state.bg.activeIndex} source=${state.bg.state.source}`);
  check('dynamic scenes have a separate page', state.bg.dynamicItems === 3, `${state.bg.dynamicItems} scenes`);
  check('local image import is offered on the static page', state.bg.inAppImport);
  check('background layer uses one of the library images', state.bg.image.startsWith('url("data:image/'), state.bg.image.slice(0, 24));
  if (builtIn) {
    const swap = await cdp.evaluate(`(() => {
      const api = window.__ccsBackground;
      const bg = document.querySelector('#ccs-skin-layers .ccs-bg');
      const before = bg ? bg.style.backgroundImage : '';
      const start = api.state.index;
      const next = (start + 1) % api.state.total;
      api.select(next, { animate: false });
      const after = bg ? bg.style.backgroundImage : '';
      api.select(start, { animate: false });
      return { changed: !!after && after !== before, next, total: api.state.total };
    })()`);
    check('background switching works', swap.changed, `${swap.total} wallpapers, changed=${swap.changed}`);
  }
} else if (bgCfg.picker === false) {
  check('background picker disabled', !state.bg.toggle, state.bg.toggle ? 'toggle still mounted' : 'absent');
}

if (shot) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
  writeFileSync(path.resolve(shot), Buffer.from(res.data, 'base64'));
  console.log(`shot -> ${shot}`);
}

const failed = checks.filter((c) => !c.ok).length;
const report = {
  when: new Date().toISOString(),
  port,
  target: target.url,
  browser: version.Browser,
  passed: checks.length - failed,
  failed,
  checks,
};
const reportPath = path.join(PROJECT_ROOT, 'logs', 'verify.json');
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`\n${failed === 0 ? 'OK' : 'FAILED'}: ${checks.length - failed}/${checks.length} checks passed -> ${reportPath}`);

cdp.close();
process.exit(failed === 0 ? 0 : 1);

