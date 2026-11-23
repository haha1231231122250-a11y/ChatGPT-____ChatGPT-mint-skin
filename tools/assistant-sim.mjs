// Simulate the assistant's input -> thinking -> done lifecycle without sending a
// real message: type into the composer, clear it, then dispatch a submit event and
// watch the state machine settle.
//   node tools/assistant-sim.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';
import { PROJECT_ROOT } from '../src/assets.mjs';

const port = Number((() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? process.argv[i + 1] : DEFAULT_PORT;
})());

const shell = await findShellTarget(port, {});
if (!shell) {
  console.error('[sim] no shell target');
  process.exit(2);
}
const cdp = await CDP.connect(shell.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => cdp.evaluate('window.__ccsAssistant ? window.__ccsAssistant.state : null');
const signals = () => cdp.evaluate('window.__ccsAssistant ? window.__ccsAssistant.signals() : null');

const box = await cdp.evaluate(`(() => {
  const el = document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (!box) {
  console.error('[sim] composer not found (open a chat first)');
  process.exit(3);
}

for (const type of ['mousePressed', 'mouseReleased']) {
  await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
}
await sleep(250);

await cdp.send('Input.insertText', { text: '测试' });
await sleep(500);
console.log('[sim] after typing:', await state(), JSON.stringify(await signals()));

await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await sleep(600);
console.log('[sim] after clearing:', await state(), JSON.stringify(await signals()));

await cdp.evaluate(`document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true }))`);
const seen = [];
for (let i = 0; i < 24; i += 1) {
  await sleep(500);
  const s = await state();
  if (seen[seen.length - 1] !== s) seen.push(s);
  if (seen.length >= 2 && s === 'idle' && i > 2) break;
}
console.log('[sim] transitions:', seen.join(' -> '));

const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 15000);
const out = path.join(PROJECT_ROOT, 'shots', 'assistant', 'sim-final.png');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('[sim] screenshot ->', path.relative(PROJECT_ROOT, out));

cdp.close();
