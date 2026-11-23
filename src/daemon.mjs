// Zero-dependency skin daemon.
//
// Attaches to the ChatGPT desktop window over the Chrome DevTools Protocol, keeps
// the mint skin mounted across reloads/navigation, and hot-reloads whenever
// config/skin.json, the styles, or the artwork change on disk.
//
//   node src/daemon.mjs                 # watch + inject until Ctrl+C
//   node src/daemon.mjs --once          # inject once and exit (used by tests)
//   node src/daemon.mjs --port 9335
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget, probeVersion } from './cdp.mjs';
import { PROJECT_ROOT } from './assets.mjs';
import { buildPayload, installScript, statusScript, uninstallScript } from './injector.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const PORT = Number(opt('port', DEFAULT_PORT));
const ROOT = path.resolve(opt('root', PROJECT_ROOT));
const ONCE = args.includes('--once');
const POLL_MS = 1000;
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'daemon.log');

mkdirSync(LOG_DIR, { recursive: true });
const PID_FILE = path.join(LOG_DIR, 'daemon.pid');
try {
  writeFileSync(PID_FILE, String(process.pid));
} catch {
  /* pid file is a convenience for skin-stop.ps1 */
}
process.on('exit', () => {
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) rmSync(PID_FILE, { force: true });
  } catch {
    /* already gone */
  }
});
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* logging must never kill the daemon */
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The daemon is a long-lived helper: a single bad evaluation must never take the
// process down, otherwise hot reload stops until the user runs the launcher again.
process.on('uncaughtException', (err) => log(`uncaught: ${err && err.message ? err.message : err}; continuing`));
process.on('unhandledRejection', (err) => log(`unhandled: ${err && err.message ? err.message : err}; continuing`));

/** Freshness fingerprint of everything that feeds the injected payload. */
function signature() {
  const files = [
    'config/skin.json',
    'src/styles/theme.css',
    'src/styles/layers.css',
    'src/styles/appearance.css',
    'src/styles/dynamic-scenes.css',
    'src/assets.mjs',
    'src/injector.mjs',
  ];
  const out = [];
  for (const rel of files) {
    try {
      const st = statSync(path.join(ROOT, rel));
      out.push(`${rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      out.push(`${rel}:missing`);
    }
  }
  // assets referenced by config
  try {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, 'config', 'skin.json'), 'utf8'));
    const refs = [cfg?.background?.asset, cfg?.chibi?.asset, ...(cfg?.characters || []).map((c) => c.asset)].filter(Boolean);
    for (const rel of refs) {
      try {
        const st = statSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel));
        out.push(`${rel}:${st.mtimeMs}:${st.size}`);
      } catch {
        out.push(`${rel}:missing`);
      }
    }
  } catch {
    out.push('config:unreadable');
  }
  return out.join('|');
}

async function attach() {
  const target = await findShellTarget(PORT, {});
  if (!target) return null;
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  return { cdp, target };
}

async function install(cdp, why) {
  const payload = buildPayload({ root: ROOT });
  if (!payload.enabled) {
    const res = await cdp.evaluate(uninstallScript());
    log(`skin disabled by config; uninstalled (${JSON.stringify(res)})`);
    return { installed: false };
  }
  const res = await cdp.evaluate(installScript(payload));
  log(`installed (${why}) marker=${res?.marker} css=${payload.css.length}B back=${res?.back} front=${res?.front}`);
  return res;
}

async function runOnce() {
  const version = await probeVersion(PORT).catch(() => null);
  if (!version) {
    log(`port ${PORT}: no DevTools endpoint. Start ChatGPT with --remote-debugging-port=${PORT}`);
    return 2;
  }
  const session = await attach();
  if (!session) {
    log(`port ${PORT}: DevTools up but no ChatGPT shell target yet`);
    return 3;
  }
  await install(session.cdp, 'once');
  session.cdp.close();
  return 0;
}

async function watch() {
  log(`daemon starting (port=${PORT}, root=${ROOT})`);
  let session = null;
  let lastSig = '';
  let lastStatus = 0;
  let installed = false;
  let backoff = 1;

  const shutdown = async (reason) => {
    log(`stopping: ${reason}`);
    try {
      if (session) {
        await session.cdp.evaluate(uninstallScript());
        session.cdp.close();
      }
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  for (;;) {
    try {
      if (!session) {
        const version = await probeVersion(PORT).catch(() => null);
        if (!version) {
          if (installed) log('DevTools endpoint gone; waiting for ChatGPT…');
          installed = false;
          await sleep(POLL_MS);
          continue;
        }
        session = await attach();
        if (!session) {
          await sleep(POLL_MS);
          continue;
        }
        log(`attached: ${session.target.url} (${version.Browser || 'unknown'})`);
        lastSig = '';
        backoff = 1;
      }

      const sig = signature();
      if (sig !== lastSig) {
        await install(session.cdp, lastSig === '' ? 'attach' : 'files changed');
        lastSig = sig;
        installed = true;
        lastStatus = Date.now();
      } else if (Date.now() - lastStatus > 2500) {
        // The renderer can swap documents (reload / route change) without closing
        // the WebSocket; re-install whenever the marker disappears.
        const status = await session.cdp.evaluate(statusScript());
        lastStatus = Date.now();
        if (!status?.installed) {
          log(`skin missing in renderer (ready=${status?.ready}); reinstalling`);
          await install(session.cdp, 'renderer reset');
        }
      }
      await sleep(POLL_MS);
    } catch (err) {
      log(`session error: ${err.message}; reconnecting`);
      try {
        session?.cdp.close();
      } catch {
        /* ignore */
      }
      session = null;
      lastSig = '';
      installed = false;
      // Back off so a closed app does not spin, but keep retrying forever: the user
      // may reopen ChatGPT minutes later and the skin should reattach on its own.
      const wait = Math.min(800 * Math.max(1, backoff++), 8000);
      await sleep(wait);
    }
  }
}

const code = ONCE ? await runOnce() : (await watch(), 0);
if (ONCE) process.exit(code);
