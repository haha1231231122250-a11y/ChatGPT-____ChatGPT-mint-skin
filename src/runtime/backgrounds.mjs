import { openWallpaperLibrary } from './wallpaper-library.mjs';
import { mountDynamicScenes } from './dynamic-scenes.mjs';

export function backgroundRuntime(config) {
  return '(' + mountBackgrounds.toString() + ')(payload, ' + JSON.stringify(config) + ', ' +
    openWallpaperLibrary.toString() + ', ' + mountDynamicScenes.toString() + ')';
}

function mountBackgrounds(payload, cfg, openLibrary, mountScenes) {
  const items = payload.backgrounds;
  const scenes = payload.dynamicBackgrounds;
  if (!items.length) return;
  const root = document.documentElement;
  const layers = document.getElementById('ccs-skin-layers');
  const front = document.getElementById('ccs-skin-front');
  if (!layers || !front) return;

  const keys = {
    index: 'ccs-bg-index', selection: 'ccs-bg-selection', play: 'ccs-bg-play',
    interval: 'ccs-bg-interval', focus: 'ccs-bg-focus',
  };
  const read = (name, fallback) => {
    try { return localStorage.getItem(name) ?? fallback; } catch { return fallback; }
  };
  const write = (name, value) => {
    try { localStorage.setItem(name, value); } catch {}
  };
  const clampIndex = (value) => {
    const i = Number(value);
    return Number.isInteger(i) ? ((i % items.length) + items.length) % items.length : 0;
  };
  const { mode, index: defaultIndex, playing: defaultPlaying, opacity = 0.9, position = 'center 18%' } = payload.backgroundState;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controls = new AbortController();
  const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: controls.signal });
  let index = clampIndex(read(keys.index, defaultIndex));
  let playing = read(keys.play, defaultPlaying ? '1' : '0') === '1';
  let intervalMs = Number(read(keys.interval, cfg.rotateMs)) || 60000;
  let focusing = read(keys.focus, '0') === '1';
  let selection = { source: 'static', id: items[index].id, name: items[index].name };
  let selectionRequest = 0;
  let pendingLocalId;
  let libraryRequest = 0;
  let page = 'static';
  let timer;
  let transitionTimer;
  let ghost;
  let library;
  let importing = false;
  let disposed = false;

  function element(type, className, text) {
    const el = document.createElement(type);
    if (className) el.className = className;
    if (text) el.textContent = text;
    if (type === 'button') el.type = 'button';
    return el;
  }
  function readImage(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取本地图片'));
      reader.readAsDataURL(blob);
    });
  }
  let base = layers.querySelector('.ccs-bg');
  if (!base) {
    base = element('div', 'ccs-bg');
    layers.prepend(base);
  }
  const fx = mountScenes(base);

  function clearTransition() {
    clearTimeout(transitionTimer);
    ghost?.remove();
    ghost = null;
  }
  function applyImage(url, animate) {
    clearTransition();
    if (animate && base.style.backgroundImage && !focusing && !motion.matches && document.visibilityState === 'visible') {
      ghost = element('div', 'ccs-bg ccs-bg-previous');
      ghost.style.backgroundImage = base.style.backgroundImage;
      ghost.style.backgroundPosition = base.style.backgroundPosition;
      ghost.style.setProperty('--ccs-bg-fade-opacity', base.style.opacity || '1');
      base.after(ghost);
      transitionTimer = setTimeout(clearTransition, 450);
    }
    const scene = selection.source === 'dynamic' ? scenes.find((entry) => entry.id === selection.id) : null;
    base.style.backgroundImage = 'url("' + url + '")';
    base.style.backgroundPosition = scene ? scene.anchor + '% center' : selection.source === 'static' ? position : 'center';
    base.style.opacity = String(opacity);
    fx.setScene(scene);
  }
  function pauseReason() {
    if (focusing) return '专注阅读';
    if (motion.matches) return '系统已开启减少动态效果';
    if (document.visibilityState !== 'visible') return '窗口位于后台';
    if (root.dataset.ccsPane === 'on' || root.dataset.ccsSafe === 'on') return '浏览器兼容模式';
    return '';
  }
  function schedule() {
    clearInterval(timer);
    const reason = pauseReason();
    const canMove = !reason;
    fx.setPlaying(canMove);
    motionStatus.textContent = selection.source === 'dynamic'
      ? (reason ? '已暂停 · ' + reason : '正在播放 · ' + selection.name) : '';
    motionStatus.hidden = selection.source !== 'dynamic';
    if (canMove && playing && !pendingLocalId && selection.source === 'static' && items.length > 1) {
      timer = setInterval(() => { if (document.visibilityState === 'visible') select(index + 1); }, Math.max(5000, intervalMs));
    }
  }
  function makeSwitch(label, className) {
    const button = element('button', className + ' ccs-bg-play');
    button.innerHTML = '<span class="ccs-bg-switch" aria-hidden="true"><i></i></span>';
    button.append(element('span', '', label));
    return button;
  }
  function switchState(button, value) {
    button.setAttribute('aria-pressed', String(value));
    button.classList.toggle('is-on', value);
  }

  const toggle = element('button', 'ccs-bg-toggle');
  toggle.id = 'ccs-bg-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'ccs-bg-panel');
  toggle.setAttribute('aria-label', '外观');
  toggle.title = '外观设置';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17.5 9.5 12l3.5 3.4 3-2.6L20 17"/></svg>';
  const panel = element('div', 'ccs-bg-panel');
  panel.id = 'ccs-bg-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '外观设置');

  const header = element('div', 'ccs-bg-head');
  const title = element('span', 'ccs-bg-title', '外观');
  const counter = element('span', 'ccs-bg-counter');
  header.append(title, counter);
  const settings = element('div', 'ccs-appearance-settings');
  const focusToggle = makeSwitch('专注阅读', 'ccs-bg-focus');
  settings.append(focusToggle);
  const astraToggle = window.__ccsAstra ? makeSwitch('Astra 联动', 'ccs-astra-link') : null;
  if (astraToggle) settings.append(astraToggle);

  const tabs = element('div', 'ccs-bg-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '背景类型');
  const pages = {};
  for (const [id, label] of [['static', '静态背景'], ['dynamic', '动态背景']]) {
    const tab = element('button', '', label);
    tab.setAttribute('role', 'tab');
    tab.id = 'ccs-bg-tab-' + id;
    const content = element('div', 'ccs-bg-page');
    content.id = 'ccs-bg-page-' + id;
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', tab.id);
    tab.setAttribute('aria-controls', content.id);
    tabs.append(tab);
    pages[id] = { tab, content };
    listen(tab, 'click', () => showPage(id));
    listen(tab, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      showPage(e.key === 'Home' ? 'static' : e.key === 'End' ? 'dynamic' : id === 'static' ? 'dynamic' : 'static', true);
    });
  }
  const staticGrid = element('div', 'ccs-bg-grid');
  const dynamicGrid = element('div', 'ccs-bg-grid');
  const motionStatus = element('p', 'ccs-bg-motion-status');
  motionStatus.setAttribute('role', 'status');
  const customGrid = element('div', 'ccs-bg-grid');
  const localHeader = element('div', 'ccs-bg-head ccs-bg-local-head');
  const localTitle = element('span', 'ccs-bg-title', '我的图片');
  const upload = element('button', 'ccs-bg-action', '导入图片');
  const filePicker = element('input');
  filePicker.type = 'file';
  filePicker.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
  filePicker.multiple = true;
  filePicker.hidden = true;
  const feedback = element('div', 'ccs-bg-feedback');
  feedback.setAttribute('role', 'status');
  localHeader.append(localTitle, upload, filePicker);
  pages.static.content.append(localHeader, feedback, customGrid, element('div', 'ccs-bg-title ccs-bg-builtins', '内置壁纸'), staticGrid);
  pages.dynamic.content.append(dynamicGrid, motionStatus);

  const foot = element('div', 'ccs-bg-foot');
  const playToggle = makeSwitch('循环播放', '');
  const intervalSel = element('select', 'ccs-bg-interval');
  intervalSel.setAttribute('aria-label', '轮换间隔');
  for (const [ms, name] of [[30000, '30 秒'], [60000, '1 分钟'], [300000, '5 分钟'], [900000, '15 分钟']]) {
    const opt = element('option', '', name);
    opt.value = String(ms);
    opt.selected = ms === intervalMs;
    intervalSel.append(opt);
  }
  foot.append(playToggle, intervalSel);
  panel.append(header, settings, tabs, pages.static.content, pages.dynamic.content, foot);
  if (cfg.picker) front.append(toggle, panel);

  function wallButton(item, source, url) {
    const button = element('button', source === 'static' ? 'ccs-bg-item' : 'ccs-bg-item-alt');
    button.dataset.source = source;
    button.dataset.wallId = item.id;
    button.title = item.name;
    const thumb = element('span', 'ccs-bg-thumb');
    if (url) thumb.style.backgroundImage = 'url("' + url + '")';
    button.append(thumb, element('span', 'ccs-bg-name', item.name));
    return button;
  }
  items.forEach((item, i) => {
    const button = wallButton(item, 'static', item.url);
    button.dataset.index = String(i);
    staticGrid.append(button);
  });
  for (const item of scenes) dynamicGrid.append(wallButton(item, 'dynamic', item.thumb || item.url));
  if (!scenes.length) dynamicGrid.append(element('p', '', '暂无动态背景'));

  function syncPanel() {
    for (const button of panel.querySelectorAll('[data-wall-id]')) {
      const active = selection.source === button.dataset.source && selection.id === button.dataset.wallId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', String(active));
    }
    counter.textContent = page === 'dynamic' ? scenes.length + ' 张' : (index + 1) + ' / ' + items.length;
    const paused = focusing || selection.source !== 'static' || motion.matches;
    switchState(playToggle, playing);
    playToggle.disabled = paused;
    intervalSel.disabled = paused;
    playToggle.lastElementChild.textContent = paused && playing ? '轮播已暂停' : '循环播放';
    switchState(focusToggle, focusing);
    if (astraToggle) switchState(astraToggle, window.__ccsAstra.linked);
  }
  function showPage(id, focus = false) {
    page = id;
    for (const [key, entry] of Object.entries(pages)) {
      entry.content.hidden = key !== id;
      entry.tab.setAttribute('aria-selected', String(key === id));
      entry.tab.tabIndex = key === id ? 0 : -1;
    }
    foot.hidden = id !== 'static';
    if (focus) pages[id].tab.focus({ preventScroll: true });
    syncPanel();
  }
  function setFocus(value) {
    focusing = value;
    write(keys.focus, value ? '1' : '0');
    if (value) root.dataset.ccsFocus = 'on'; else delete root.dataset.ccsFocus;
    if (value) clearTransition();
    schedule();
    syncPanel();
  }
  function change(item, source, url, animate) {
    selection = { source, id: item.id, name: item.name };
    write(keys.selection, JSON.stringify({ source, id: item.id }));
    applyImage(url, animate);
    schedule();
    syncPanel();
  }
  function select(value, options = {}) {
    selectionRequest += 1;
    pendingLocalId = null;
    index = clampIndex(value);
    write(keys.index, String(index));
    change(items[index], 'static', items[index].url, options.animate !== false);
  }
  function selectScene(id, animate = true) {
    const item = scenes.find((entry) => entry.id === id);
    if (!item) return false;
    selectionRequest += 1;
    pendingLocalId = null;
    change(item, 'dynamic', item.url, animate);
    return true;
  }
  function setPlaying(value) {
    playing = Boolean(value);
    write(keys.play, playing ? '1' : '0');
    syncPanel();
    schedule();
  }

  const getLibrary = () => library ||= openLibrary();
  async function selectLocal(id, animate = true) {
    const request = ++selectionRequest;
    pendingLocalId = id;
    // Keep the current image while reading it, but prevent a rotation from taking over mid-read.
    clearInterval(timer);
    let picked = false;
    try {
      const item = await getLibrary().get(id);
      if (!item) throw new Error('找不到这张本地图片');
      const url = await readImage(item.image);
      if (!disposed && request === selectionRequest) {
        pendingLocalId = null;
        change(item, 'local', url, animate);
        picked = true;
      }
    } catch (err) {
      if (!disposed && request === selectionRequest) feedback.textContent = err.message;
    } finally {
      if (!disposed && request === selectionRequest && !picked) {
        pendingLocalId = null;
        if (!animate) select(index, { animate: false });
        else schedule();
      }
    }
  }
  function renderLocal(entries) {
    customGrid.replaceChildren();
    for (const entry of entries.sort((a, b) => b.added - a.added)) {
      const card = element('div', 'ccs-bg-local-card');
      const button = wallButton(entry, 'local');
      const remove = element('button', 'ccs-bg-remove', '删除');
      remove.dataset.removeId = entry.id;
      remove.setAttribute('aria-label', '删除 ' + entry.name);
      card.append(button, remove);
      customGrid.append(card);
      void readImage(entry.thumb).then((url) => {
        if (card.isConnected) button.firstElementChild.style.backgroundImage = 'url("' + url + '")';
      }, () => {});
    }
    syncPanel();
  }
  async function refreshLocal(showCount = true) {
    const request = ++libraryRequest;
    try {
      const entries = await getLibrary().list();
      if (disposed || request !== libraryRequest) return;
      renderLocal(entries);
      upload.disabled = importing || entries.length >= getLibrary().limit;
      if (showCount) feedback.textContent = entries.length + ' / ' + getLibrary().limit + ' 张 · 仅保存在此设备';
    } catch (err) {
      if (!disposed && request === libraryRequest) {
        upload.disabled = true;
        feedback.textContent = err.message;
      }
    }
  }
  async function importPhotos() {
    const files = Array.from(filePicker.files || []);
    filePicker.value = '';
    if (!files.length || importing) return;
    importing = true;
    upload.disabled = true;
    feedback.textContent = '正在导入…';
    const errors = [];
    let added = 0;
    for (const file of files) {
      if (disposed) break;
      try { await getLibrary().add(file); added += 1; }
      catch (err) { errors.push(file.name.slice(0, 120) + '：' + err.message); }
    }
    importing = false;
    if (disposed) return;
    await refreshLocal(false);
    if (!disposed) feedback.textContent = ['已导入 ' + added + ' 张', ...errors].join('\n');
  }
  async function removeLocal(id) {
    try {
      await getLibrary().remove(id);
      if (disposed) return;
      const cancelled = pendingLocalId === id;
      if (cancelled) {
        selectionRequest += 1;
        pendingLocalId = null;
      }
      if (selection.source === 'local' && selection.id === id) {
        const fallback = items[index];
        change(fallback, 'static', fallback.url, true);
      } else if (cancelled) {
        schedule();
      }
      await refreshLocal();
      if (!disposed && !panel.hidden && page === 'static') (upload.disabled ? pages.static.tab : upload).focus();
    } catch (err) {
      if (!disposed) feedback.textContent = err.message;
    }
  }
  function open(value, restoreFocus = true) {
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    toggle.classList.toggle('is-open', value);
    if (value) {
      showPage(selection.source === 'dynamic' ? 'dynamic' : 'static', true);
      void refreshLocal();
    } else if (restoreFocus) {
      toggle.focus({ preventScroll: true });
    }
  }
  listen(toggle, 'click', () => open(panel.hidden));
  listen(panel, 'click', (e) => {
    const button = e.target.closest('[data-wall-id], [data-remove-id]');
    if (!button) return;
    if (button.dataset.removeId) { void removeLocal(button.dataset.removeId); return; }
    const { source, wallId } = button.dataset;
    if (source === 'static') select(Number(button.dataset.index));
    if (source === 'dynamic') selectScene(wallId);
    if (source === 'local') void selectLocal(wallId);
  });
  listen(focusToggle, 'click', () => setFocus(!focusing));
  if (astraToggle) listen(astraToggle, 'click', () => {
    window.__ccsAstra.setLinked(!window.__ccsAstra.linked);
    syncPanel();
  });
  listen(playToggle, 'click', () => setPlaying(!playing));
  listen(intervalSel, 'change', () => setIntervalMs(Number(intervalSel.value)));
  listen(upload, 'click', () => filePicker.click());
  listen(filePicker, 'change', () => { void importPhotos(); });
  listen(document, 'keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      if (panel.contains(e.target) || toggle === e.target) e.stopPropagation();
      open(false, panel.contains(document.activeElement) || toggle === document.activeElement);
    }
  });
  listen(document, 'click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) open(false, false);
  });
  listen(document, 'visibilitychange', schedule);
  listen(document, 'ccs-browser-pane-change', schedule);
  listen(motion, 'change', () => { clearTransition(); schedule(); syncPanel(); });

  function setIntervalMs(value) {
    intervalMs = Math.max(5000, Number(value) || 60000);
    write(keys.interval, String(intervalMs));
    if (Array.from(intervalSel.options).some((opt) => Number(opt.value) === intervalMs)) intervalSel.value = String(intervalMs);
    schedule();
  }

  let saved;
  try { saved = JSON.parse(read(keys.selection, 'null')); } catch {}
  applyImage(items[index].url, false);
  showPage('static');
  setFocus(focusing);
  if (cfg.picker && saved?.source === 'local' && typeof saved.id === 'string') void selectLocal(saved.id, false);
  else if (cfg.picker && saved?.source === 'dynamic' && !selectScene(saved.id, false)) select(index, { animate: false });

  window.__ccsBackground = {
    get list() { return items.map(({ id, name }) => ({ id, name })); },
    get state() { return { index, ...selection, total: items.length, playing, focusing, intervalMs, mode }; },
    select(i, opts) { select(i, opts); return this.state; },
    play(v) { setPlaying(v); return this.state; },
    setIntervalMs(ms) { setIntervalMs(ms); return this.state; },
    dispose() {
      disposed = true;
      controls.abort();
      clearInterval(timer);
      clearTransition();
      library?.close();
      fx.dispose();
      panel.remove();
      toggle.remove();
      delete root.dataset.ccsFocus;
      delete window.__ccsBackground;
    },
  };
}

