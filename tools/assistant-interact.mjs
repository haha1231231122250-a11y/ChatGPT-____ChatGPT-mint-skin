// Exercise Sol's interactive layer and capture the result.
//   node tools/assistant-interact.mjs            # click, drag, reset, picker shift
//   node tools/assistant-interact.mjs --no-shot  # state checks only
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';
import { PROJECT_ROOT } from '../src/assets.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt('port', DEFAULT_PORT));
const shotDir = path.join(PROJECT_ROOT, 'shots', 'interact');
const wantShots = !args.includes('--no-shot');

const shell = await findShellTarget(port, {});
if (!shell) {
  console.error('[interact] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(shell.webSocketDebuggerUrl);
mkdirSync(shotDir, { recursive: true });

const snap = async (name) => {
  if (!wantShots) return;
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 15000);
  const file = path.join(shotDir, `${name}.png`);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`[interact] shot -> ${path.relative(PROJECT_ROOT, file)}`);
};

const has = await cdp.evaluate('!!(window.__ccsAssistant && window.__ccsAssistant.pets !== undefined)');
if (!has) {
  console.error('[interact] assistant runtime missing; run tools/theme-lab.mjs --skin first');
  cdp.close();
  process.exit(3);
}

const result = await cdp.evaluate(`(async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const api = window.__ccsAssistant;
  const el = document.getElementById('ccs-assistant');
  const hit = el && el.querySelector('.ccs-sol-hit');
  if (!hit) return { ok: false, reason: 'no click target' };
  const rect = () => {
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const send = (type, extra) => hit.dispatchEvent(new PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', button: 0,
  }, extra)));

  const before = { pets: api.pets, position: api.position };
  const c0 = rect();
  send('pointerdown', { clientX: c0.x, clientY: c0.y, buttons: 1 });
  send('pointerup', { clientX: c0.x, clientY: c0.y, buttons: 0 });
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: c0.x, clientY: c0.y }));
  await wait(220);
  const afterClick = {
    pets: api.pets,
    caption: (el.querySelector('.ccs-sol-caption') || {}).textContent || '',
    react: el.dataset.ccsReact || null,
  };

  const c1 = rect();
  send('pointerdown', { clientX: c1.x, clientY: c1.y, buttons: 1 });
  for (let i = 1; i <= 5; i++) {
    hit.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', buttons: 1,
      clientX: c1.x - i * 90, clientY: c1.y - i * 14,
    }));
    await wait(40);
  }
  send('pointerup', { clientX: c1.x - 450, clientY: c1.y - 70, buttons: 0 });
  await wait(200);
  const afterDrag = { position: api.position, stored: localStorage.getItem('ccs-sol-pos') };

  api.resetPosition();
  await wait(220);
  const afterReset = { position: api.position, stored: localStorage.getItem('ccs-sol-pos') };

  const toggle = document.getElementById('ccs-bg-toggle');
  const panel = document.getElementById('ccs-bg-panel');
  let shifted = null;
  if (toggle && panel) {
    if (panel.hidden) toggle.click();
    await wait(260);
    shifted = el.dataset.ccsShifted || null;
  }
  return { ok: true, before, afterClick, afterDrag, afterReset, shifted };
})()`);

if (!result.ok) {
  console.error('[interact]', result.reason);
  cdp.close();
  process.exit(4);
}

await snap('picker-open');
await cdp.evaluate(`(() => {
  const toggle = document.getElementById('ccs-bg-toggle');
  const panel = document.getElementById('ccs-bg-panel');
  if (toggle && panel && !panel.hidden) toggle.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 260));
await snap('after-picker-close');

console.log('[interact]', JSON.stringify(result, null, 2));
cdp.close();
