// Compact inspection of one visible element + the tokens that look blue/purple.
// Usage: node tools/inspect-el.mjs "获取 Plus"
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';

const text = process.argv[2] || '';
const target = await findShellTarget(DEFAULT_PORT, {});
const cdp = await CDP.connect(target.webSocketDebuggerUrl);

const res = await cdp.evaluate(`(() => {
  const want = ${JSON.stringify(text)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const all = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
  const hits = all.filter((el) => {
    const t = norm(el.textContent);
    if (!t || !t.includes(want)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  });
  if (!hits.length) return { found: false };
  hits.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
  const el = hits[0];
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const path = [];
  for (let n = el; n && n !== document.body && path.length < 5; n = n.parentElement) {
    path.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className ? '.' + n.className.toString().split(' ').slice(0, 2).join('.') : ''));
  }
  const blueish = [];
  for (const name of Array.from(cs)) {
    if (!name.startsWith('--')) continue;
    const v = cs.getPropertyValue(name).trim();
    if (!v || v.length > 90) continue;
    if (/blue|purple|2c67c5|e8f3fe|0285ff|3a83f7|0c274a/i.test(name + ' ' + v)) blueish.push(name + '=' + v);
  }
  return {
    found: true,
    path,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    bg: cs.backgroundColor,
    color: cs.color,
    border: cs.borderColor,
    bgImage: cs.backgroundImage.slice(0, 90),
    blueish: blueish.slice(0, 24),
  };
})()`);
console.log(JSON.stringify(res, null, 1));
cdp.close();
