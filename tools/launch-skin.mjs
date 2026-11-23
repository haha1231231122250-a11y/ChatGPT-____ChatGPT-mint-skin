// Node-side launcher used by the desktop shortcut.
//
// Why not a PowerShell launcher: 火绒/Defender 会删掉"指向 powershell + 隐藏窗口 + 脚本"
// 的快捷方式。这个入口用 node.exe 作为目标，行为更"开发者工具"，脚本里再用 cmd start
// 以正常窗口尺寸拉起 ChatGPT，避免子进程继承 SW_HIDE。
//
// Usage: node tools/launch-skin.mjs [--port 9335] [--proxy http://127.0.0.1:7890]
//                                  [--background] [--quiet]
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'logs');
const PID_FILE = path.join(LOGS, 'daemon.pid');
const DAEMON = path.join(ROOT, 'src', 'daemon.mjs');
const LOCK_FILE = path.join(LOGS, 'launcher.lock');
const ALIAS = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(opt('port', 9335));
const PROXY = opt('proxy', '');
const QUIET = args.includes('--quiet');
const BACKGROUND = args.includes('--background');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const line = `[launch] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  mkdirSync(LOGS, { recursive: true });
  try {
    appendFileSync(path.join(LOGS, 'launcher.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
  if (!QUIET) console.log(line);
};

// 单实例锁：连续双击不会启动两个注入流程
function acquireLock() {
  mkdirSync(LOGS, { recursive: true });
  while (true) {
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const owner = readPid(LOCK_FILE);
    if (owner === null) continue;
    // The other launcher may still be writing its PID.
    const lockTime = statSync(LOCK_FILE, { throwIfNoEntry: false })?.mtimeMs;
    if (lockTime === undefined) continue;
    if ((owner === 0 && Date.now() - lockTime < 5000) || pidExists(owner)) {
      log('another launcher is starting or running; nothing to do');
      process.exit(0);
    }
    if (readPid(LOCK_FILE) === owner && statSync(LOCK_FILE, { throwIfNoEntry: false })?.mtimeMs === lockTime) {
      rmSync(LOCK_FILE, { force: true });
    }
  }
  process.on('exit', () => {
    try {
      if (readPid(LOCK_FILE) === process.pid) rmSync(LOCK_FILE, { force: true });
    } catch {}
  });
}
acquireLock();

async function version() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1800);
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function appExists() {
  // AppExecutionAlias 是 0 字节的 reparse point，existsSync 会跟丢；用 lstat 判定
  try {
    lstatSync(ALIAS);
    return true;
  } catch {
    return false;
  }
}

function appProcessCount() {
  const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (out.error || out.status !== 0 || typeof out.stdout !== 'string') return null;
  return out.stdout.split('\n').filter((l) => l.toLowerCase().includes('chatgpt.exe')).length;
}

function startApp() {
  if (!appExists()) throw new Error(`ChatGPT 找不到：${ALIAS}`);
  const appArgs = [
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    ...(PROXY ? [`--proxy-server=${PROXY}`] : []),
  ];
  // 直接 CreateProcess 启动别名（不套 cmd start：0 字节 reparse 别名在 cmd 里会启动失败）。
  // windowsHide:false 让子进程拿到正常显示方式，窗口不会被建成隐藏态。
  log('starting ChatGPT', appArgs.join(' '));
  if (BACKGROUND) {
    // 开机自启：最小化启动，不抢焦点；注入不依赖窗口可见
    const quoted = `"${ALIAS}" ${appArgs.map((a) => `"${a}"`).join(' ')}`;
    spawn('cmd.exe', ['/c', 'start', '""', '/min', quoted], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    // 直接 CreateProcess 会继承本进程的显示状态：快捷方式以最小化/隐藏窗口运行 node，
    // ChatGPT 也会被建成隐藏态（日志里就是 "window visibility=hidden"）。用
    // Start-Process -WindowStyle Normal 强制正常显示；powershell 自身仍然隐藏。
    const list = appArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
    const cmd = `Start-Process -FilePath '${ALIAS.replace(/'/g, "''")}' -ArgumentList @(${list}) -WindowStyle Normal`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], {
      stdio: 'ignore',
      windowsHide: true,
    });
    ps.on('error', (e) => log(`启动器失败: ${e.message}`));
  }
}

function readPid(file) {
  try {
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return 0;
    const pid = Number(raw);
    return /^\d+$/.test(raw) && pid > 0 && pid <= 0xffffffff ? pid : -1;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function pidExists(pid) {
  if (!pid || pid < 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function daemonPidAlive() {
  const pid = readPid(PID_FILE);
  if (!pidExists(pid)) return 0;

  const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $ErrorActionPreference = 'Stop'
    $proc = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'
    if ($proc.Name -eq 'node.exe') { [Console]::Write($proc.CommandLine) }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  if (result.status !== 0) throw new Error('无法核对美化守护进程的身份');

  // Match the script argument itself and the requested port, rather than a
  // substring that could also appear in an unrelated Node command.
  const command = result.stdout.trim().match(/^(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|([^\s"]+))(?:\s+--port\s+(\d+))?$/);
  if (!command) return 0;
  const [, quotedScript, bareScript, port = '9335'] = command;
  const scriptPath = quotedScript ?? bareScript;
  return path.isAbsolute(scriptPath) && path.normalize(scriptPath).toLowerCase() === DAEMON.toLowerCase() &&
    Number(port) === PORT ? pid : 0;
}

async function startDaemon() {
  mkdirSync(LOGS, { recursive: true });
  rmSync(PID_FILE, { force: true });
  const out = openSync(path.join(LOGS, 'daemon.out.log'), 'a');
  let err;
  let child;
  try {
    err = openSync(path.join(LOGS, 'daemon.err.log'), 'a');
    child = spawn(process.execPath, [DAEMON, '--port', String(PORT)], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', out, err],
      windowsHide: true,
    });
  } finally {
    closeSync(out);
    if (err !== undefined) closeSync(err);
  }
  child.on('error', (error) => log(`daemon 未启动: ${error.message}`));
  child.unref();
  // Hold the launcher lock until the daemon registers its own PID.
  for (let i = 0; i < 50 && pidExists(child.pid); i++) {
    if (readPid(PID_FILE) === child.pid) {
      log(`daemon started (pid ${child.pid})`);
      return;
    }
    await sleep(100);
  }
  throw new Error('daemon 未确认启动，见 logs/daemon.err.log');
}

async function pageVisible() {
  try {
    // Windows 上动态 import 需要 file:// URL，直接传盘符路径会抛 ERR_UNSUPPORTED_ESM_URL_SCHEME
    const cdpUrl = pathToFileURL(path.join(ROOT, 'src', 'cdp.mjs')).href;
    const { CDP, findShellTarget } = await import(cdpUrl);
    const target = await findShellTarget(PORT, {});
    if (!target) return null;
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    const state = await cdp.evaluate('document.visibilityState');
    cdp.close();
    return state;
  } catch {
    return null;
  }
}

function restoreWindow() {
  const script = path.join(ROOT, 'tools', 'show-window.ps1');
  if (!existsSync(script)) return;
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Quiet'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function notify(message) {
  log(message);
  if (BACKGROUND || QUIET) return;
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${message.replace(/'/g, "''")}', 'ChatGPT Mint Skin') | Out-Null`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (err) => log(`提示窗口无法打开: ${err.message}`));
  child.unref();
}

async function waitVisible(rounds, waitMs = 1200) {
  restoreWindow();
  let vis = null;
  for (let i = 0; i < rounds; i++) {
    vis = await pageVisible();
    if (vis === 'visible') return vis;
    await sleep(waitMs);
  }
  return vis;
}

async function waitDevtools(ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await version();
    if (v) return v;
    await sleep(700);
  }
  return null;
}

let v = await version();

if (!v) {
  const running = appProcessCount();
  if (running !== 0) {
    if (!BACKGROUND) restoreWindow();
    notify(running === null
      ? '无法确认 ChatGPT 是否已经打开。请查看任务栏或系统托盘，确认完全退出后再打开美化版。'
      : 'ChatGPT 已经打开，当前窗口会保留。请先保存草稿、等待任务结束，再从系统托盘退出 ChatGPT，然后重新打开美化版。');
  } else {
    startApp();
    v = await waitDevtools(45000);
    if (!v) {
      notify('等待 ChatGPT 调试端口超时。请查看美化包 logs/launcher.log，并确认客户端是否已启动。');
      process.exitCode = 1;
    }
  }
}

if (v) {
  log(`DevTools ready (${v.Browser})`);
  if (!BACKGROUND && await waitVisible(5) !== 'visible') {
    notify('当前 ChatGPT 窗口无法自动显示。请从任务栏或系统托盘打开原窗口，美化包会在后台尝试加载。');
  }
  try {
    const pid = daemonPidAlive();
    if (pid) log(`daemon already running (pid ${pid})`);
    else await startDaemon();
    log('done');
  } catch (err) {
    notify(err.message);
    process.exitCode = 1;
  }
}
