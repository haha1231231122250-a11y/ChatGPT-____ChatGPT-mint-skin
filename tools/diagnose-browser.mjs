// Inspect docked and legacy Codex browser hosts and A/B the skin rules.
//   node tools/diagnose-browser.mjs                 # report only
//   node tools/diagnose-browser.mjs --safe off      # turn the escape hatch off
//   node tools/diagnose-browser.mjs --uninstall     # strip the skin, report again
//   node tools/diagnose-browser.mjs --shot shots/browser-pane.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CDP, DEFAULT_PORT, listTargets, findShellTarget } from '../src/cdp.mjs';
import { PROJECT_ROOT } from '../src/assets.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt('port', DEFAULT_PORT));
const safe = opt('safe', '');
const shot = opt('shot', '');
const wantUninstall = args.includes('--uninstall');

const report = { when: new Date().toISOString(), port, targets: [], detached: null, shell: null, verdict: null };

const targets = await listTargets(port);
report.targets = targets.map((t) => ({ type: t.type, title: (t.title || '').slice(0, 60), url: (t.url || '').slice(0, 90) }));

const shell = await findShellTarget(port, {});
if (!shell) {
  console.error('[browser] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(shell.webSocketDebuggerUrl);

if (safe) {
  await cdp.evaluate(`(() => {
    if (${JSON.stringify(safe)} === 'on') document.documentElement.dataset.ccsSafe = 'on';
    else delete document.documentElement.dataset.ccsSafe;
    document.dispatchEvent(new Event('ccs-browser-pane-change'));
    return document.documentElement.dataset.ccsSafe || null;
  })()`);
  console.log(`[browser] escape hatch -> ${safe}`);
}

const probe = `(() => {
  const root = document.documentElement;
  const webviews = Array.from(document.querySelectorAll('webview')).map((w) => {
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const chain = [];
    let n = w.parentElement;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      const s = getComputedStyle(n);
      chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 40), radius: s.borderRadius, overflow: s.overflow, filter: s.filter, backdrop: s.backdropFilter, transform: s.transform, opacity: s.opacity });
    }
    return {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      opacity: cs.opacity, visibility: cs.visibility, display: cs.display,
      pointerEvents: cs.pointerEvents, background: cs.backgroundColor, radius: cs.borderRadius, overflow: cs.overflow,
      chain,
    };
  });
  const hits = [];
  for (const y of [120, 300, 480]) {
    for (const x of [Math.round(innerWidth * 0.55), Math.round(innerWidth * 0.8)]) {
      const el = document.elementFromPoint(x, y);
      hits.push({ x, y, tag: el ? el.tagName : null, id: el ? el.id : '', cls: el ? String(el.className).slice(0, 40) : '' });
    }
  }
  const v = webviews.find((view) => view.visibility === 'visible' && view.opacity !== '0') || null;
  const docked = Array.from(document.querySelectorAll('#root :is([data-browser-sidebar-primary-focus-target], [data-browser-sidebar-chrome-expanded])')).some(el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return !el.closest('[hidden]') && rect.width >= 8 && rect.height >= 8 &&
      rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight &&
      style.visibility === 'visible' && Number(style.opacity) > 0;
  });
  const overlay = document.getElementById('ccs-skin-front');
  return {
    href: location.href,
    size: [innerWidth, innerHeight],
    marker: root.dataset.ccsSkin || null,
    safe: root.dataset.ccsSafe || null,
    kind: root.dataset.ccsPaneKind || (docked ? 'docked, skin not detecting' : null),
    styleBytes: (() => { const s = document.getElementById('ccs-skin-style'); return s ? s.textContent.length : 0; })(),
    webviews,
    hits,
    checks: docked || v ? {
      nativePaneMode: !overlay || root.dataset.ccsPane === 'on' || root.dataset.ccsSafe === 'on',
      skinOverlayHidden: !overlay || getComputedStyle(overlay).display === 'none',
      nativeHitTargets: hits.every((hit) => !String(hit.id).startsWith('ccs-') && !hit.cls.includes('ccs-')),
    } : null,
  };
})()`;

report.shell = await cdp.evaluate(probe);
report.verdict = report.shell.checks
  ? Object.entries(report.shell.checks).map(([k, ok]) => `${ok ? 'OK ' : 'BAD'} ${k}`)
  : ['no visible docked or legacy browser host in the main window'];

const detachedTarget = targets.find((t) => (t.url || '').includes('/detached-window'));
if (detachedTarget) {
  try {
    const d = await CDP.connect(detachedTarget.webSocketDebuggerUrl);
    report.detached = await d.evaluate(`(() => {
      const root = document.getElementById('root');
      return {
        href: location.href,
        marker: document.documentElement.dataset.ccsSkin || null,
        hasStyle: !!document.getElementById('ccs-skin-style'),
        rootChildren: root ? root.children.length : -1,
        textLength: (document.body.innerText || '').length,
        webviews: document.querySelectorAll('webview').length,
      };
    })()`);
    d.close();
  } catch (err) {
    report.detached = { error: err.message };
  }
}

if (shot) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 15000);
  mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
  writeFileSync(path.resolve(shot), Buffer.from(res.data, 'base64'));
  report.shot = shot;
  console.log(`[browser] shot -> ${shot}`);
}

const out = path.join(PROJECT_ROOT, 'logs', 'browser-diagnose.json');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

console.log('[browser] targets:', report.targets.length);
for (const t of report.targets) console.log(`  ${t.type.padEnd(8)} ${t.url}`);
console.log('[browser] main window:', JSON.stringify({ marker: report.shell.marker, safe: report.shell.safe, size: report.shell.size, kind: report.shell.kind, webviews: report.shell.webviews.length }));
if (report.shell.webviews[0]) {
  const v = report.shell.webviews[0];
  console.log('[browser] webview:', JSON.stringify({ rect: v.rect, background: v.background, radius: v.radius, overflow: v.overflow, opacity: v.opacity, pointerEvents: v.pointerEvents }));
}
console.log('[browser] detached window:', JSON.stringify(report.detached));
console.log('[browser] verdict:', report.verdict.join('; '));
console.log(`[browser] report -> ${path.relative(PROJECT_ROOT, out)}`);

cdp.close();

if (wantUninstall) {
  console.log('[browser] uninstalling skin for the A/B baseline ...');
  const res = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'tools', 'theme-lab.mjs'), '--uninstall'], {
    cwd: PROJECT_ROOT, encoding: 'utf8',
  });
  console.log((res.stdout || '').trim());
  console.log('[browser] skin removed. Reopen the browser pane, then run: node tools/theme-lab.mjs --skin');
}
