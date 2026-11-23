// dom-dump.mjs — read-only DOM reconnaissance for the ChatGPT desktop shell page.
// Usage: node tools/dom-dump.mjs [--port 9335] [--label initial]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, findShellTarget, probeVersion, DEFAULT_PORT } from '../src/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', DEFAULT_PORT));
const label = arg('label', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(join(root, 'recon'), { recursive: true });

const version = await probeVersion(port);
console.log('[recon] browser:', version.Browser);
const target = await findShellTarget(port, null);
if (!target) {
  console.error('[recon] no app:// shell target found; targets:', (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map((t) => `${t.type} ${t.url}`));
  process.exit(1);
}
console.log('[recon] target:', target.title, '|', target.url);

const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const frameTree = await cdp.send('Page.getFrameTree');

const summary = await cdp.evaluate(`(() => {
  const out = {};
  out.href = location.href;
  out.title = document.title;
  out.readyState = document.readyState;
  out.ua = navigator.userAgent;
  out.colorScheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  out.metas = [...document.querySelectorAll('meta[http-equiv]')].map((m) => ({ httpEquiv: m.httpEquiv, content: m.content }));
  out.cspMeta = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')].map((m) => m.content);
  out.webviews = [...document.querySelectorAll('webview')].map((w) => ({ src: w.getAttribute('src'), partition: w.getAttribute('partition'), id: w.id }));
  out.iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, id: f.id, name: f.name, rect: f.getBoundingClientRect().toJSON() }));
  out.scripts = [...document.scripts].map((s) => s.src || '(inline)').slice(0, 25);
  out.bodyAttrs = document.body ? [...document.body.attributes].map((a) => [a.name, a.value.slice(0, 120)]) : null;
  out.htmlAttrs = [...document.documentElement.attributes].map((a) => [a.name, a.value.slice(0, 120)]);
  out.bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : null;
  out.htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  out.bodyColor = document.body ? getComputedStyle(document.body).color : null;
  out.fontFamily = getComputedStyle(document.body || document.documentElement).fontFamily;
  out.rootChildren = [...(document.getElementById('root')?.children || [])].length;
  out.counts = {};
  for (const tag of ['nav','aside','main','header','footer','section','article','button','textarea','input','form','ul','li','a','img','svg','webview','iframe','div','span']) {
    out.counts[tag] = document.querySelectorAll(tag).length;
  }
  out.testIds = [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))].slice(0, 120);
  out.ariaLabels = [...new Set([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')))].slice(0, 120);
  out.ids = [...new Set([...document.querySelectorAll('[id]')].map((e) => e.id))].slice(0, 120);
  out.topClasses = (() => {
    const freq = new Map();
    for (const el of document.querySelectorAll('body *')) {
      for (const c of el.classList) freq.set(c, (freq.get(c) || 0) + 1);
    }
    return [...freq.entries()].sort((a,b) => b[1]-a[1]).slice(0, 80);
  })();
  // Fixed / sticky top-level overlays (sidebars, headers, composer)
  out.fixed = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' || cs.position === 'sticky';
  }).slice(0, 40).map((el) => ({ tag: el.tagName, id: el.id, cls: [...el.classList].join(' '), pos: getComputedStyle(el).position, z: getComputedStyle(el).zIndex, rect: el.getBoundingClientRect().toJSON() }));
  // CSP probes: inline <style>, style attribute, data: image, inline script
  const probe = document.createElement('style');
  probe.textContent = 'body{--ccs-probe-style:1}';
  document.head.appendChild(probe);
  out.cspProbe = {
    styleElement: getComputedStyle(document.body).getPropertyValue('--ccs-probe-style').trim() === '1',
  };
  const p2 = document.createElement('div');
  p2.style.cssText = 'position:absolute;--ccs-probe-attr:2';
  document.body.appendChild(p2);
  out.cspProbe.styleAttribute = getComputedStyle(p2).getPropertyValue('--ccs-probe-attr').trim() === '2';
  p2.remove(); probe.remove();
  out.outerHTMLLength = document.documentElement.outerHTML.length;
  // Landmark map: elements that carry identity or occupy a meaningful share of the viewport.
  const vw = innerWidth * innerHeight;
  const depthOf = (el) => { let d = 0; while (el && el !== document.body) { d++; el = el.parentElement; } return d; };
  out.landmarks = [...document.querySelectorAll('#root *')].filter((el) => {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    return el.id || el.getAttribute('role') || el.getAttribute('aria-label') || el.getAttribute('data-testid') || area >= vw * 0.04;
  }).slice(0, 260).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      cls: [...el.classList].slice(0, 5).join(' ').slice(0, 160) || undefined,
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      testid: el.getAttribute('data-testid') || undefined,
      depth: depthOf(el),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      pos: cs.position,
      z: cs.zIndex,
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      overflow: cs.overflow,
    };
  });
  return out;
})()`);

// data: image probe (needs async)
const dataImageOk = await cdp.evaluate(`new Promise((res) => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = new Image();
  img.onload = () => res(true);
  img.onerror = () => res(false);
  img.src = 'data:image/png;base64,' + b64;
  setTimeout(() => res(false), 3000);
})`);
summary.cspProbe.dataImage = dataImageOk;

// Script injection viability (CDP evaluate runs regardless; this checks page-side eval/eval-like execution)
summary.cspProbe.evalAllowed = await cdp.evaluate(`(() => { try { return (0, eval)('1+1') === 2; } catch { return false; } })()`);

const html = await cdp.evaluate(`document.documentElement.outerHTML`);
const htmlPath = join(root, 'recon', `dom-${label}.html`);
writeFileSync(htmlPath, html, 'utf8');
const jsonPath = join(root, 'recon', `recon-${label}.json`);
writeFileSync(jsonPath, JSON.stringify({ when: new Date().toISOString(), target: { title: target.title, url: target.url }, frameTree, summary }, null, 2), 'utf8');

console.log('[recon] written:');
console.log('  ', htmlPath);
console.log('  ', jsonPath);
console.log('[recon] summary:', JSON.stringify({
  href: summary.href,
  title: summary.title,
  colorScheme: summary.colorScheme,
  cspMeta: summary.cspMeta,
  cspProbe: summary.cspProbe,
  counts: summary.counts,
  webviews: summary.webviews,
  iframes: summary.iframes.map((f) => ({ src: f.src, id: f.id })),
  testIds: summary.testIds.slice(0, 40),
  mainFrame: frameTree.frameTree.frame.url,
}, null, 2));

cdp.close();
