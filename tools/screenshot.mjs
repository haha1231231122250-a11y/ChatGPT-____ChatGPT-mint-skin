// Capture a screenshot of the ChatGPT main window through CDP.
// Usage: node tools/screenshot.mjs --out shots/x.png [--port 9335] [--force]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const out = opt('out', 'shots/shot.png');
const port = Number(opt('port', DEFAULT_PORT));
const force = args.includes('--force');

const target = await findShellTarget(port, {});
if (!target) {
  console.error('[shot] no shell target at port', port);
  process.exit(2);
}

const cdp = await CDP.connect(target.webSocketDebuggerUrl);

// A minimized / tray-hidden window never finishes Page.captureScreenshot; fail fast
// with a hint instead of blocking the caller.
const state = await cdp.evaluate('({ visibility: document.visibilityState, w: innerWidth, h: innerHeight })');
if (state.visibility !== 'visible' && !force) {
  cdp.close();
  console.error(`[shot] window is ${state.visibility} (${state.w}x${state.h}); restore the ChatGPT window and retry, or pass --force`);
  process.exit(3);
}

let res;
try {
  res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, undefined, 15000);
} catch (err) {
  cdp.close();
  console.error(`[shot] capture failed: ${err.message}. If the window is minimized, restore it first.`);
  process.exit(4);
}
cdp.close();

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(res.data, 'base64'));
console.log(`[shot] ${target.url} ${state.w}x${state.h} -> ${out}`);
