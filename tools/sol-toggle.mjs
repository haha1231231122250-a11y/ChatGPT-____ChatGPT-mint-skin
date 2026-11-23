// Show, hide or toggle Sol from the command line (same path as the glass button).
//   node tools/sol-toggle.mjs            # toggle
//   node tools/sol-toggle.mjs --show
//   node tools/sol-toggle.mjs --hide --shot shots/sol-hidden.png
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
const shot = opt('shot', '');
const want = args.includes('--show') ? true : args.includes('--hide') ? false : null;

const shell = await findShellTarget(port, {});
if (!shell) {
  console.error('[sol] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(shell.webSocketDebuggerUrl);
const has = await cdp.evaluate('!!(window.__ccsAssistant && window.__ccsAssistant.setVisible)');
if (!has) {
  console.error('[sol] runtime not installed; run tools/theme-lab.mjs --skin first');
  cdp.close();
  process.exit(3);
}

const result = await cdp.evaluate(`(() => {
  const api = window.__ccsAssistant;
  const next = ${want === null ? '!api.visible' : JSON.stringify(want)};
  api.setVisible(next);
  return {
    visible: api.visible,
    flag: document.documentElement.dataset.ccsSol || null,
    pressed: (document.getElementById('ccs-sol-toggle') || {}).getAttribute
      ? document.getElementById('ccs-sol-toggle').getAttribute('aria-pressed')
      : null,
    hidden: document.getElementById('ccs-assistant')
      ? getComputedStyle(document.getElementById('ccs-assistant')).visibility
      : null,
  };
})()`);
console.log('[sol]', JSON.stringify(result));

if (shot) {
  await new Promise((r) => setTimeout(r, 450));
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 15000);
  const file = path.resolve(shot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`[sol] shot -> ${path.relative(PROJECT_ROOT, file)}`);
}

cdp.close();
