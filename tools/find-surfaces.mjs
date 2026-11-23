// find-surfaces.mjs — locate opaque surfaces and app design tokens in the live shell.
// Usage: node tools/find-surfaces.mjs [--label surfaces]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, findShellTarget, DEFAULT_PORT } from '../src/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : DEFAULT_PORT);
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'surfaces';

const target = await findShellTarget(port, null);
if (!target) { console.error('no shell target'); process.exit(1); }
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const data = await cdp.evaluate(`(() => {
  const vw = innerWidth, vh = innerHeight;
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(part + '#' + cur.id); break; }
      const stable = [...cur.classList].filter((c) => c.includes('/') || c.includes(':') || /^(app-shell|startup)/.test(c));
      if (stable.length) part += '.' + stable.slice(0, 2).join('.');
      else if (cur.getAttribute('role')) part += '[role="' + cur.getAttribute('role') + '"]';
      else if (cur.getAttribute('aria-label')) part += '[aria-label="' + cur.getAttribute('aria-label') + '"]';
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const surfaces = [];
  for (const el of document.querySelectorAll('html, body, #root, #root *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !/rgba\\(.*,\\s*0(\\.0+)?\\)$/.test(bg);
    const areaRatio = (r.width * r.height) / (vw * vh);
    if (!opaque || areaRatio < 0.12) continue;
    surfaces.push({
      path: cssPath(el),
      tag: el.tagName.toLowerCase(),
      cls: [...el.classList].slice(0, 4).join(' '),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      areaPct: +(areaRatio * 100).toFixed(1),
      bg,
      z: cs.zIndex,
      pos: cs.position,
      opacity: cs.opacity,
      overflow: cs.overflow,
    });
  }
  surfaces.sort((a, b) => b.areaPct - a.areaPct);
  const tokens = {};
  const cs = getComputedStyle(document.documentElement);
  for (const name of cs) {
    if (!name.startsWith('--')) continue;
    if (!/background|surface|border|forest|mint|accent|sidebar|wallpaper|gray|text/i.test(name)) continue;
    const v = cs.getPropertyValue(name).trim();
    if (!v || v.length > 220) continue;
    tokens[name] = v;
  }
  const rootKids = [...(document.getElementById('root')?.children || [])].map((el) => {
    const cs2 = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: [...el.classList].slice(0, 3).join(' '), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], pos: cs2.position, z: cs2.zIndex, bg: cs2.backgroundColor };
  });
  return { viewport: [vw, vh], surfaces, rootKids, tokenCount: Object.keys(tokens).length, tokens };
})()`);

const out = join(root, 'recon', `surfaces-${label}.json`);
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), target: { url: target.url }, ...data }, null, 2));
console.log('[surfaces] viewport', data.viewport.join('x'), '| tokens', data.tokenCount, '| ->', out);
console.log('[surfaces] root children:', JSON.stringify(data.rootKids));
console.log('[surfaces] opaque surfaces >=12% viewport:');
for (const s of data.surfaces.slice(0, 30)) {
  console.log('  ', s.areaPct + '%', s.rect.join(','), 'z=' + s.z, s.pos, s.bg, '|', s.path, '|', s.cls.slice(0, 90));
}
cdp.close();
