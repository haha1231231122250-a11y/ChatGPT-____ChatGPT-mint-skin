// Builds the CDP `Runtime.evaluate` payloads that mount/unmount the skin inside the
// ChatGPT Electron renderer. Everything is idempotent: re-installing replaces the
// previous style/layers instead of stacking duplicates.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, buildMarkup, buildVars, fileToDataUrl, loadBackgrounds, loadConfig } from './assets.mjs';
import { assistantRuntime } from './runtime/assistant.mjs';
import { astraRuntime } from './runtime/astra.mjs';
import { backgroundRuntime } from './runtime/backgrounds.mjs';
import { mountBrowserCompatibility } from './runtime/browser-pane.mjs';

export const STYLE_ID = 'ccs-skin-style';
export const BACK_ID = 'ccs-skin-layers';
export const FRONT_ID = 'ccs-skin-front';
export const ROOT_MARKER = 'data-ccs-skin';

export function loadStyles(root = PROJECT_ROOT) {
  const dir = path.join(root, 'src', 'styles');
  return ['theme.css', 'layers.css', 'appearance.css', 'dynamic-scenes.css']
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

export function buildPayload({ root = PROJECT_ROOT, config } = {}) {
  const cfg = config || loadConfig(root);
  const assistantOn = cfg.assistant?.enabled !== false && cfg.assistant?.states;
  const bg = cfg.background || {};
  const wantLibrary = bg.picker !== false || bg.mode === 'rotate';
  const backgrounds = wantLibrary ? loadBackgrounds(root, bg) : [];
  const dynamicBackgrounds = bg.picker === false ? [] : [
    ['garden', '薄荷花园', 42, { astra: [27, 31], sol: [59, 49] }],
    ['rain', '窗边细雨', 50, { astra: [37, 36], sol: [62, 46] }],
    ['fireflies', '月夜萤火', 45, { astra: [34, 32], sol: [56, 46] }],
  ].map(([id, name, anchor, portraits]) => ({
    id, name, anchor, portraits, url: fileToDataUrl(root, `assets/dynamic/${id}.webp`),
    thumb: fileToDataUrl(root, `assets/dynamic/${id}-thumb.webp`),
  })).filter((item) => item.url);
  const astraOn = cfg.chibi?.enabled !== false && Boolean(cfg.chibi?.asset);
  if (backgrounds.length) {
    const bytes = backgrounds.reduce((sum, item) => sum + item.url.length, 0);
    if (bytes > 6 * 1024 * 1024) {
      console.warn(`[injector] wallpaper payload is ${(bytes / 1024 / 1024).toFixed(1)} MB; consider fewer/smaller backgrounds`);
    }
  }
  const startIndex = (() => {
    if (!backgrounds.length) return 0;
    const byAsset = backgrounds.findIndex((item) => item.asset === bg.asset);
    if (byAsset >= 0) return byAsset;
    if (bg.mode === 'random') return Math.floor(Math.random() * backgrounds.length);
    return 0;
  })();
  return {
    marker: cfg.marker || 'mint',
    safe: cfg.codexBrowser?.safe !== false,
    css: loadStyles(root),
    vars: buildVars(cfg),
    markup: buildMarkup(root, cfg),
    enabled: cfg.enabled !== false,
    assistant: assistantOn ? assistantRuntime(cfg.assistant) : '',
    astra: astraOn ? astraRuntime() : '',
    astraExpressions: astraOn ? Object.fromEntries(['think', 'cool', 'shy', 'sleepy', 'surprise'].map((id) => [
      id, fileToDataUrl(root, `assets/chibi/chibi-${id}.webp`),
    ])) : {},
    solPoses: assistantOn && cfg.assistant.body === 'assets/sol/body.webp' ? Object.fromEntries(['blink', 'wave', 'think', 'stretch', 'cheer'].map((id) => [
      id, fileToDataUrl(root, `assets/sol/pose-${id}.webp`),
    ])) : {},
    dynamicBackgrounds,
    backgrounds: backgrounds.map((item) => ({ id: item.id, name: item.name, asset: item.asset, url: item.url })),
    backgroundState: {
      mode: bg.mode || 'fixed',
      opacity: bg.opacity,
      position: bg.position,
      index: startIndex,
      playing: bg.mode === 'rotate',
    },
    backgroundRuntime: backgrounds.length ? backgroundRuntime({
      mode: bg.mode || 'fixed',
      rotateMs: bg.rotateMs,
      picker: bg.picker !== false,
      opacity: bg.opacity,
      position: bg.position,
    }) : '',
  };
}

const INSTALL_JS = ({ assistant: assistantCode, astra: astraCode, backgroundRuntime: backgroundCode, ...payload }) => `(() => {
  const payload = ${JSON.stringify(payload)};
  const root = document.documentElement;
  const prev = window.__ccsSkin;
  try { if (prev && typeof prev.dispose === 'function') prev.dispose(); } catch (e) {}
  try { if (window.__ccsAssistant && typeof window.__ccsAssistant.dispose === 'function') window.__ccsAssistant.dispose(); } catch (e) {}
  try { if (window.__ccsBackground && typeof window.__ccsBackground.dispose === 'function') window.__ccsBackground.dispose(); } catch (e) {}
  try { window.__ccsAstra?.dispose(); } catch (e) {}

  const oldStyle = document.getElementById('ccs-skin-style');
  if (oldStyle) oldStyle.remove();
  const style = document.createElement('style');
  style.id = 'ccs-skin-style';
  style.textContent = payload.css;
  (document.head || root).appendChild(style);

  for (const [name, value] of Object.entries(payload.vars)) {
    if (value != null) root.style.setProperty(name, String(value));
  }
  root.dataset.ccsSkin = payload.marker;
  if (payload.safe) root.dataset.ccsSafe = 'on'; else delete root.dataset.ccsSafe;

  const host = document.createElement('div');
  host.innerHTML = payload.markup;
  const nodes = Array.from(host.children);
  for (const id of ['ccs-skin-layers', 'ccs-skin-front']) {
    const stale = document.getElementById(id);
    if (stale) stale.remove();
  }
  const body = document.body || root;
  // front is appended after back so DOM order matches z-order even if z-index is
  // ever stripped by the host app
  for (const node of nodes) body.prepend(node);

  if (window.__ccsPaneTimer) { clearInterval(window.__ccsPaneTimer); delete window.__ccsPaneTimer; }
  const disposeBrowser = (${mountBrowserCompatibility.toString()})();
  const api = {
    installed: true,
    marker: payload.marker,
    installedAt: Date.now(),
    dispose() {
      const s = document.getElementById('ccs-skin-style');
      if (s) s.remove();
      for (const id of ['ccs-skin-layers', 'ccs-skin-front']) {
        const n = document.getElementById(id);
        if (n) n.remove();
      }
      for (const name of Object.keys(payload.vars)) root.style.removeProperty(name);
      delete root.dataset.ccsSkin;
      delete root.dataset.ccsSafe;
      disposeBrowser();
      try { if (window.__ccsAssistant && typeof window.__ccsAssistant.dispose === 'function') window.__ccsAssistant.dispose(); } catch (e) {}
      try { if (window.__ccsBackground && typeof window.__ccsBackground.dispose === 'function') window.__ccsBackground.dispose(); } catch (e) {}
      try { window.__ccsAstra?.dispose(); } catch (e) {}
      delete window.__ccsSkin;
    },
  };
  window.__ccsSkin = api;

  ${astraCode ? `try { ${astraCode} } catch (e) { console.warn('[ccs] Astra runtime failed', e); }` : ''}
  ${backgroundCode ? `try { ${backgroundCode} } catch (e) { console.warn('[ccs] background runtime failed', e); }` : ''}
  ${assistantCode ? `try { ${assistantCode} } catch (e) { console.warn('[ccs] assistant runtime failed', e); }` : ''}

  return {
    ok: true,
    marker: payload.marker,
    cssBytes: payload.css.length,
    payloadBytes: payload.backgrounds ? payload.backgrounds.reduce((n, b) => n + b.url.length, 0) : 0,
    back: document.getElementById('ccs-skin-layers') ? document.getElementById('ccs-skin-layers').children.length : 0,
    front: document.getElementById('ccs-skin-front') ? document.getElementById('ccs-skin-front').children.length : 0,
    assistant: window.__ccsAssistant ? window.__ccsAssistant.state : null,
    background: window.__ccsBackground ? window.__ccsBackground.state : null,
  };
})()`;

const UNINSTALL_JS = `(() => {
  const api = window.__ccsSkin;
  if (api && typeof api.dispose === 'function') { api.dispose(); return { ok: true, removed: true }; }
  try { if (window.__ccsAssistant && typeof window.__ccsAssistant.dispose === 'function') window.__ccsAssistant.dispose(); } catch (e) {}
  try { if (window.__ccsBackground && typeof window.__ccsBackground.dispose === 'function') window.__ccsBackground.dispose(); } catch (e) {}
  try { window.__ccsAstra?.dispose(); } catch (e) {}
  const root = document.documentElement;
  const s = document.getElementById('ccs-skin-style');
  if (s) s.remove();
  for (const id of ['ccs-skin-layers', 'ccs-skin-front']) {
    const n = document.getElementById(id);
    if (n) n.remove();
  }
  delete root.dataset.ccsSkin;
  delete root.dataset.ccsSafe;
  delete root.dataset.ccsPane;
  delete root.dataset.ccsPaneKind;
  if (window.__ccsPaneTimer) { clearInterval(window.__ccsPaneTimer); delete window.__ccsPaneTimer; }
  return { ok: true, removed: false };
})()`;

const STATUS_JS = `(() => {
  const api = window.__ccsSkin;
  const back = document.getElementById('ccs-skin-layers');
  const front = document.getElementById('ccs-skin-front');
  const style = document.getElementById('ccs-skin-style');
  const sol = document.getElementById('ccs-assistant');
  return {
    installed: !!(api && api.installed) && !!back && !!front && !!style,
    marker: document.documentElement.dataset.ccsSkin || null,
    styleBytes: style ? style.textContent.length : 0,
    back: back ? Array.from(back.children).map((n) => n.className) : [],
    front: front ? Array.from(front.children).map((n) => n.className) : [],
    assistant: window.__ccsAssistant ? window.__ccsAssistant.state : null,
    assistantNode: !!sol,
    background: window.__ccsBackground ? window.__ccsBackground.state : null,
    backgroundNodes: {
      toggle: !!document.getElementById('ccs-bg-toggle'),
      panel: !!document.getElementById('ccs-bg-panel'),
      items: document.querySelectorAll('#ccs-bg-panel .ccs-bg-item').length,
    },
    href: location.href,
    ready: document.readyState,
  };
})()`;

export const installScript = (payload) => INSTALL_JS(payload);
export const uninstallScript = () => UNINSTALL_JS;
export const statusScript = () => STATUS_JS;
