// Config + asset loading. Assets become data: URLs so the injected CSS/HTML never
// needs network access and CSP never interferes (img-src allows data:).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export const DEFAULT_CONFIG = {
  enabled: true,
  port: 9335,
  marker: 'mint',
  // Browser compatibility suspends the theme; safe exposes that mode manually.
  codexBrowser: { safe: false, opaqueHost: true },
  palette: {
    surface: 'rgba(255, 255, 255, 0.72)',
    sidebar: 'rgba(247, 254, 250, 0.66)',
    rail: 'rgba(238, 250, 244, 0.72)',
    chrome: 'rgba(240, 250, 245, 0)',
    ink: '#172a21',
    inkSoft: 'rgba(23, 42, 33, 0.62)',
    border: 'rgba(74, 140, 110, 0.2)',
    borderStrong: 'rgba(74, 140, 110, 0.34)',
    accent: '#47a377',
    accentStrong: '#2f8a63',
    accentSoft: '#e6f7ee',
    accentSoft2: '#d4f0e2',
    radius: '18px',
  },
  background: {
    // "fixed" uses `asset`; "random" picks one entry from `list` on every re-inject;
    // "rotate" cycles `list` from the runtime every `rotateMs` (pausable in the picker).
    mode: 'fixed',
    rotateMs: 60000,
    picker: true,
    list: [],
    asset: 'assets/background-garden.webp',
    opacity: 0.9,
    position: 'center center',
  },
  characters: [],
  chibi: { enabled: false, asset: 'assets/chibi/chibi-happy.webp' },
  assistant: {
    enabled: false,
    name: 'Sol',
    mode: 'bubble',
    visible: true,
    controls: true,
    size: '30vh',
    right: '16px',
    bottom: '104px',
    opacity: 1,
    doneMs: 2500,
    smileMs: 5000,
    quiescenceMs: 1200,
    // Local-only interactions: nothing here talks to the network or reads messages.
    interactive: { enabled: true, click: true, drag: true, hover: true, idle: true },
    captionMs: 2600,
    idleMs: 60000,
    greet: true,
    lines: {
      greet: ['早上好呀', '下午好～', '晚上好', '这么晚还在呀'],
      click: ['在呢在呢', '有什么我可以帮你的吗', '你又戳我～', '我在认真看着你哦'],
      pet: { 3: '唔…好痒', 10: '今天也要加油哦', 25: '再摸就要收费啦' },
    },
    signals: { sendLabel: '发送', stopLabel: '停止' },
    body: 'assets/sol/body.webp',
    states: {
      idle: { emote: 'assets/sol/emote-idle.webp', animation: 'breathe' },
      listening: { emote: 'assets/sol/emote-listening.webp', animation: 'breathe-fast' },
      thinking: { emote: 'assets/sol/emote-thinking.webp', animation: 'sway' },
      done: { emote: 'assets/sol/emote-done.webp', animation: 'bounce' },
      error: { emote: 'assets/sol/emote-error.webp', animation: 'shake' },
      hug: { emote: 'assets/sol/emote-hug.webp', animation: 'breathe-fast' },
    },
  },
};

const deepMerge = (base, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] ? deepMerge(base[k], v) : v;
  }
  return out;
};

export function loadConfig(root = PROJECT_ROOT) {
  const file = path.join(root, 'config', 'skin.json');
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[assets] cannot read ${file}: ${err.message}; using defaults`);
  }
  const cfg = deepMerge(DEFAULT_CONFIG, raw);
  // An empty `characters` array means "no cutouts": single-character themes such as
  // the Sol assistant do not need the old placeholder silhouettes.
  if (!Array.isArray(cfg.characters)) cfg.characters = [];
  return cfg;
}

const dataUrlCache = new Map();

export function fileToDataUrl(root, rel) {
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    console.warn(`[assets] missing asset: ${rel}`);
    return null;
  }
  const key = `${abs}:${st.mtimeMs}:${st.size}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;
  const mime = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const url = `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
  dataUrlCache.set(key, url);
  if (dataUrlCache.size > 64) dataUrlCache.delete(dataUrlCache.keys().next().value);
  return url;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Resolve the wallpaper: fixed `asset`, or a random entry from `list`. */
function pickBackground(root, bg) {
  const list = Array.isArray(bg?.list) ? bg.list.filter(Boolean) : [];
  if (bg?.mode === 'random' && list.length) {
    const choice = list[Math.floor(Math.random() * list.length)];
    const url = fileToDataUrl(root, choice);
    if (url) return url;
    console.warn(`[assets] random background not found: ${choice}; falling back to ${bg.asset}`);
  }
  return fileToDataUrl(root, bg?.asset);
}

const MANIFEST = path.join('assets', 'backgrounds', 'index.json');

const prettyName = (rel) =>
  path
    .basename(String(rel))
    .replace(/\.(webp|png|jpe?g|avif|gif)$/i, '')
    .replace(/^bg-\d+[-_]?/i, '')
    .replace(/^\d{2}[-_]/, '') || path.basename(String(rel));

/** Wallpaper library, in display order: index.json first, `background.list` as fallback. */
export function loadBackgrounds(root = PROJECT_ROOT, bg = {}) {
  const list = Array.isArray(bg?.list) ? bg.list.filter(Boolean) : [];
  let entries = [];
  try {
    const raw = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
    if (Array.isArray(raw)) {
      entries = raw
        .filter((e) => e && e.asset)
        .map((e) => ({ id: e.id || path.basename(String(e.asset), path.extname(String(e.asset))), name: e.name || prettyName(e.asset), asset: e.asset }));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[assets] cannot read ${MANIFEST}: ${err.message}`);
  }
  if (!entries.length) entries = list.map((asset) => ({ id: path.basename(String(asset), path.extname(String(asset))), name: prettyName(asset), asset }));
  const missing = [];
  const out = [];
  for (const entry of entries) {
    const url = fileToDataUrl(root, entry.asset);
    if (!url) {
      missing.push(entry.asset);
      continue;
    }
    out.push({ id: entry.id, name: entry.name, asset: entry.asset, url });
  }
  if (missing.length) console.warn(`[assets] missing backgrounds: ${missing.join(', ')}`);
  return out;
}

/** Build the fixed decoration markup (background + characters + chibi).
 *  `back` sits below the app (#root z-index 1); `front` sits above it so the
 *  character reads as a foreground cutout while staying pointer-transparent. */
export function buildMarkup(root, config) {
  const back = [];
  const front = [];
  const bgUrl = pickBackground(root, config.background);
  if (bgUrl) {
    back.push(
      `<div class="ccs-bg" style="background-image:url('${bgUrl}');opacity:${Number(config.background.opacity ?? 0.9)};background-position:${esc(config.background.position || 'center bottom')}"></div>`,
    );
  }
  for (const ch of config.characters || []) {
    if (ch?.enabled === false) continue;
    const url = fileToDataUrl(root, ch.asset);
    if (!url) continue;
    const side = ch.side === 'left' ? 'left' : 'right';
    const bucket = (ch.layer || (side === 'left' ? 'back' : 'front')) === 'back' ? back : front;
    bucket.push(
      `<img class="ccs-char ccs-char-${side}" src="${url}" alt="" ` +
        `style="height:${esc(ch.height || '64vh')};${side}:${esc(ch.offset || '-40px')};bottom:${esc(ch.bottom || '-20px')};` +
        `opacity:${Number(ch.opacity ?? 0.95)}" draggable="false">`,
    );
  }
  const chibi = config.chibi;
  if (chibi?.enabled !== false && chibi?.asset) {
    const url = fileToDataUrl(root, chibi.asset);
    if (url) {
      front.push(
        `<button id="ccs-astra" class="ccs-chibi" type="button" aria-label="和 Astra 互动" title="和 Astra 互动" ` +
          `style="width:${esc(chibi.width || '96px')};left:${esc(chibi.left || '72px')};bottom:${esc(chibi.bottom || '112px')};opacity:${Number(chibi.opacity ?? 1)}">` +
          `<img src="${url}" alt="" draggable="false"><span class="ccs-visually-hidden" role="status"></span></button>`,
      );
    }
  }
  const asst = config.assistant;
  if (asst?.enabled !== false && asst?.states) {
    const bodyUrl = fileToDataUrl(root, asst.body);
    const emotes = Object.entries(asst.states)
      .map(([name, st]) => {
        const url = fileToDataUrl(root, st?.emote);
        return url ? `<img class="ccs-sol-emote" data-state="${esc(name)}" src="${url}" alt="" draggable="false">` : '';
      })
      .filter(Boolean)
      .join('');
    const idleAnim = asst.states.idle?.animation || 'breathe';
    const interactive = asst.interactive !== false && asst.interactive?.enabled !== false;
    front.push(
      `<div id="ccs-assistant" data-ccs-state="idle" data-ccs-mode="${esc(asst.mode || 'bubble')}" ` +
        `data-ccs-anim="${esc(idleAnim)}" data-ccs-interactive="${interactive ? 'on' : 'off'}">` +
        `${bodyUrl ? `<img class="ccs-sol-body" src="${bodyUrl}" alt="" draggable="false">` : ''}` +
        `<div class="ccs-sol-emotes">${emotes}</div>` +
        `<span class="ccs-sol-dots" aria-hidden="true"><i></i><i></i><i></i></span>` +
        `<div class="ccs-sol-caption" role="status" hidden></div>` +
        `<div class="ccs-sol-hearts" aria-hidden="true"><i></i><i></i><i></i></div>` +
        `${interactive ? '<span class="ccs-sol-hit" aria-hidden="true"></span>' : ''}` +
        `</div>`,
    );
    // A tiny glass button lets the user hide/bring back Sol without editing config.
    if (asst.controls !== false) {
      front.push(
        `<button id="ccs-sol-toggle" type="button" class="ccs-sol-toggle" aria-pressed="true" ` +
          `aria-label="隐藏 Sol" title="隐藏 / 显示 Sol">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
          `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
          `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/>` +
          `<circle cx="12" cy="12" r="3.2"/>` +
          `<path class="ccs-sol-slash" d="M4.5 19.5 19.5 4.5"/>` +
          `</svg></button>`,
      );
    }
  }
  return (
    `<div id="ccs-skin-layers" aria-hidden="true" style="pointer-events:none">${back.join('')}</div>` +
    `<div id="ccs-skin-front" style="pointer-events:none">${front.join('')}</div>`
  );
}

/** Palette -> CSS custom properties consumed by src/styles/theme.css. */
export function buildVars(config) {
  const p = config.palette || {};
  return {
    '--ccs-surface': p.surface,
    '--ccs-sidebar': p.sidebar,
    '--ccs-rail': p.rail,
    '--ccs-chrome': p.chrome,
    '--ccs-ink': p.ink,
    '--ccs-ink-soft': p.inkSoft,
    '--ccs-border': p.border,
    '--ccs-border-strong': p.borderStrong,
    '--ccs-accent': p.accent,
    '--ccs-accent-strong': p.accentStrong,
    '--ccs-accent-soft': p.accentSoft,
    '--ccs-accent-soft-2': p.accentSoft2,
    '--ccs-radius': p.radius,
    '--ccs-sol-size': config.assistant?.size,
    '--ccs-sol-right': config.assistant?.right,
    '--ccs-sol-bottom': config.assistant?.bottom,
    '--ccs-sol-opacity': config.assistant?.opacity == null ? null : String(config.assistant.opacity),
  };
}

