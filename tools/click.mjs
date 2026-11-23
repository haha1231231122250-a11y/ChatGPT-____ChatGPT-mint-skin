// Click an element by visible text using real CDP mouse events (user gesture).
// Usage: node tools/click.mjs "个体户与企业区别" [--exact] [--port 9335]
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith('--'));
const exact = args.includes('--exact');
const port = Number((() => {
  const i = args.indexOf('--port');
  return i >= 0 ? args[i + 1] : DEFAULT_PORT;
})());

const target = await findShellTarget(port, {});
if (!target) {
  console.error('[click] no shell target');
  process.exit(2);
}
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const found = await cdp.evaluate(`(() => {
  const want = ${JSON.stringify(text)};
  const exact = ${exact};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const label = (el) => norm(el.getAttribute('aria-label')) || norm(el.textContent);
  const all = Array.from(document.querySelectorAll('button, a, [role="button"], [role="listitem"], [role="option"], [role="menuitem"], [role="tab"]'));
  const hits = all.filter((el) => {
    const t = label(el);
    if (!t || !(exact ? t === want : t.includes(want))) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0;
  });
  if (!hits.length) return { ok: false };
  hits.sort((a, b) => label(a).length - label(b).length);
  const el = hits[0];
  const r = el.getBoundingClientRect();
  return { ok: true, text: norm(el.textContent).slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
})()`);
if (!found.ok) {
  console.error('[click] no match');
  process.exit(3);
}
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: found.x,
    y: found.y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  await new Promise((r) => setTimeout(r, 60));
}
console.log('[click]', JSON.stringify(found));
cdp.close();
