// Fast visual iteration against the live main window.
//   node tools/theme-lab.mjs --skin --shot shots/skin-01.png   # full production payload
//   node tools/theme-lab.mjs --uninstall                        # remove the skin
//   node tools/theme-lab.mjs --css recon/lab-01.css --shot ...  # raw CSS experiment
//   node tools/theme-lab.mjs --status
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';
import { buildPayload, installScript, statusScript, uninstallScript } from '../src/injector.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const optsAll = (name) => {
  const out = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
};

const port = Number(opt('port', DEFAULT_PORT));
const shot = opt('shot', '');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

const assets = {};
for (const spec of optsAll('asset')) {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq);
  const file = path.resolve(spec.slice(eq + 1));
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  assets[name] = `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

const target = await findShellTarget(port, {});
if (!target) {
  console.error('[lab] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
let result;

if (args.includes('--uninstall')) {
  result = await cdp.evaluate(uninstallScript());
  console.log('[lab] uninstalled', JSON.stringify(result));
} else if (args.includes('--status')) {
  result = await cdp.evaluate(statusScript());
  console.log('[lab] status', JSON.stringify(result, null, 1));
} else if (args.includes('--skin')) {
  const payload = buildPayload({});
  result = await cdp.evaluate(installScript(payload));
  console.log(`[lab] skin installed css=${payload.css.length}B layers=${payload.markup.length}B`, JSON.stringify(result));
} else {
  let css = optsAll('css')
    .map((f) => readFileSync(path.resolve(f), 'utf8'))
    .join('\n');
  for (const [name, url] of Object.entries(assets)) css = css.split(`ccs-asset:${name}`).join(url);
  await cdp.evaluate(`(() => {
    const { css } = ${JSON.stringify({ css })};
    document.documentElement.dataset.ccsLab = '1';
    let s = document.getElementById('ccs-lab');
    if (!s) { s = document.createElement('style'); s.id = 'ccs-lab'; document.head.appendChild(s); }
    s.textContent = css;
    return true;
  })()`);
  console.log(`[lab] raw css ${css.length}B`);
}

if (args.includes('--probe')) {
  const probe = await cdp.evaluate(`(() => {
    const out = [];
    const sel = ['main', 'aside', 'body', 'html', '#app-shell-sidebar'];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.push({ sel: s, bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 70) });
    }
    return out;
  })()`);
  console.log(JSON.stringify(probe));
}

if (shot) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(path.dirname(shot), { recursive: true });
  writeFileSync(shot, Buffer.from(res.data, 'base64'));
  console.log(`[lab] shot -> ${shot}`);
}
cdp.close();
