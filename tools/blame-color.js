// Find which element paints the blue hue around a text label.
// Usage: node tools/blame-color.js "获取 Plus"
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';

const want = process.argv[2] || '';
const target = await findShellTarget(DEFAULT_PORT, {});
const cdp = await CDP.connect(target.webSocketDebuggerUrl);

const res = await cdp.evaluate(`(() => {
  const want = ${JSON.stringify(want)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const parseRgb = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blueish = (s) => {
    const c = parseRgb(s);
    return c && c.a > 0.03 && c.b - c.r > 22;
  };
  const anchors = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'))
    .filter((el) => {
      const t = norm(el.textContent);
      const r = el.getBoundingClientRect();
      return t && t.includes(want) && r.width > 2 && r.height > 2;
    });
  if (!anchors.length) return { found: false };
  anchors.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
  const anchor = anchors[0];
  const scope = [];
  let node = anchor;
  for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) scope.push(node);
  const candidates = [];
  for (const n of scope) {
    for (const el of [n, ...n.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 40) continue;
      const hits = [];
      if (blueish(cs.backgroundColor)) hits.push('background:' + cs.backgroundColor);
      if (blueish(cs.borderColor)) hits.push('border:' + cs.borderColor);
      if (blueish(cs.color)) hits.push('color:' + cs.color);
      if (/rgb|#/.test(cs.backgroundImage) && blueish(cs.backgroundImage)) hits.push('gradient:' + cs.backgroundImage.slice(0, 70));
      if (cs.boxShadow && cs.boxShadow !== 'none' && blueish(cs.boxShadow)) hits.push('shadow:' + cs.boxShadow.slice(0, 70));
      if (hits.length) {
        candidates.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className && el.className.toString().slice(0, 80),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          hits,
        });
      }
    }
  }
  return { found: true, anchorCls: anchor.className && anchor.className.toString().slice(0, 80), candidates: candidates.slice(0, 12) };
})()`);
console.log(JSON.stringify(res, null, 1));
cdp.close();
