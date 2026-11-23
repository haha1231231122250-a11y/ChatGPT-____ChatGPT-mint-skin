// Exercise the background picker: open the panel, switch wallpapers, verify rotation.
//   node tools/background-test.mjs                  # full run
//   node tools/background-test.mjs --index 5        # switch to a specific wallpaper
//   node tools/background-test.mjs --rotate-wait 7  # seconds to wait for one rotation tick
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';
import { PROJECT_ROOT, loadConfig } from '../src/assets.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt('port', DEFAULT_PORT));
const wantIndex = Number(opt('index', 1));
const rotateWait = Number(opt('rotate-wait', 7));
const config = loadConfig(PROJECT_ROOT);
const interval = Number(config.background?.rotateMs) >= 5000 ? Number(config.background.rotateMs) : 60000;

const target = await findShellTarget(port, {});
if (!target) {
  console.error('[bg] no shell target');
  process.exit(2);
}
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const shotDir = path.join(PROJECT_ROOT, 'shots', 'bg');
mkdirSync(shotDir, { recursive: true });

const shot = async (name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 20000);
  const file = path.join(shotDir, `${name}.png`);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  return path.relative(PROJECT_ROOT, file);
};

const has = await cdp.evaluate('!!window.__ccsBackground');
if (!has) {
  console.error('[bg] runtime missing; install the skin first');
  cdp.close();
  process.exit(3);
}

const before = await cdp.evaluate(`(() => {
  const api = window.__ccsBackground;
  const panel = document.getElementById('ccs-bg-panel');
  if (panel && panel.hidden) document.getElementById('ccs-bg-toggle').click();
  return { state: api.state, panelOpen: panel ? !panel.hidden : false };
})()`);
await new Promise((r) => setTimeout(r, 350));
console.log('[bg] panel', JSON.stringify(before), '->', await shot('panel'));

const picked = await cdp.evaluate(`(() => {
  const api = window.__ccsBackground;
  api.select(${wantIndex}, { animate: true });
  return api.state;
})()`);
await new Promise((r) => setTimeout(r, 600));
console.log('[bg] select', JSON.stringify(picked), '->', await shot('select'));

const rotated = await cdp.evaluate(`(() => {
  const api = window.__ccsBackground;
  const start = api.state.index;
  api.setIntervalMs(5000);
  api.play(true);
  return { start };
})()`);
await new Promise((r) => setTimeout(r, Math.max(6000, rotateWait * 1000)));
const afterRotate = await cdp.evaluate('window.__ccsBackground.state');
console.log('[bg] rotate', JSON.stringify({ ...rotated, ...afterRotate, advanced: afterRotate.index !== rotated.start }), '->', await shot('rotate'));

const restored = await cdp.evaluate(`(() => {
  const api = window.__ccsBackground;
  api.select(${before.state.index}, { animate: false });
  api.setIntervalMs(${before.state.intervalMs});
  api.play(${before.state.playing});
  return api.state;
})()`);
console.log('[bg] restored', JSON.stringify(restored));

cdp.close();
