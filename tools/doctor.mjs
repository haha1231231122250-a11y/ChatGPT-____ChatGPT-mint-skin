// Health check + one-command repair for the skin's launch entries.
//
//   node tools/doctor.mjs                 # read-only report
//   node tools/doctor.mjs --repair        # recreate shortcuts + icon cache
//   node tools/doctor.mjs --autostart on  # install the Startup entry (background launch)
//   node tools/doctor.mjs --json          # machine-readable
//
// Exit code: 0 = healthy / repaired, 1 = problems found.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHORTCUT_PS = path.join(ROOT, 'tools', 'lib', 'shortcut.ps1');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'config', 'shortcut.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const jsonMode = flag('json');
const autostartArg = opt('autostart', '');
const PORT = Number(opt('port', cfg.port || 9335));
const PROXY = opt('proxy', cfg.proxy || '');
const NODE = process.execPath;
const ICON_SRC = path.join(ROOT, cfg.icon || 'assets/app-icon.ico');
const ICON_DIR = path.join(process.env.LOCALAPPDATA || '', 'chatgpt-mint-skin');
const ICON = path.join(ICON_DIR, 'app-icon.ico');
const LAUNCHER = path.join(ROOT, cfg.launcher || 'tools/launch-skin.mjs');
const ICON_SCRIPT = path.join(ROOT, 'tools', 'set-shortcut-icon.ps1');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const checks = [];
const check = (name, ok, detail, kind = 'entry') => checks.push({ name, ok: !!ok, detail: detail ?? '', kind });

function ps(scriptArgs) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SHORTCUT_PS, ...scriptArgs], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'powershell failed').trim());
  return r.stdout.trim();
}

function folders() {
  const code = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
@{
  desktop = [Environment]::GetFolderPath('Desktop')
  programs = [Environment]::GetFolderPath('Programs')
  startup = [Environment]::GetFolderPath('Startup')
} | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', code], {
    encoding: 'utf8',
    windowsHide: true,
  });
  try {
    return JSON.parse(r.stdout.trim());
  } catch {
    return {};
  }
}

const dirs = folders();
const lnkPaths = {
  desktop: dirs.desktop ? path.join(dirs.desktop, `${cfg.name}.lnk`) : '',
  startMenu: dirs.programs ? path.join(dirs.programs, `${cfg.name} Mint Skin.lnk`) : '',
  iconTool: dirs.programs ? path.join(dirs.programs, '换成 Sol 图标.lnk') : '',
  startup: dirs.startup ? path.join(dirs.startup, `${cfg.name} Mint Skin.lnk`) : '',
};

function readLink(p) {
  if (!p) return { exists: false };
  try {
    return JSON.parse(ps(['-Action', 'read', '-Path', p]));
  } catch {
    return { exists: false };
  }
}

function linkArgs(extra = '') {
  const parts = [`"${LAUNCHER}"`, '--port', String(PORT)];
  if (PROXY) parts.push('--proxy', PROXY);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

function writeLink(target, extraArgs = '') {
  ps([
    '-Action', 'write',
    '-Path', target,
    '-Target', NODE,
    '-Arguments', linkArgs(extraArgs),
    '-Icon', `${ICON},0`,
    '-Workdir', ROOT,
    '-WindowStyle', '7',
    '-Description', 'Launch ChatGPT with the mint skin',
  ]);
}

function refreshIconCache() {
  try {
    ps(['-Action', 'iconcache']);
  } catch {
    /* best effort */
  }
}

function iconToolArgs() {
  return `-NoProfile -ExecutionPolicy Bypass -File "${ICON_SCRIPT}" -ShowResult`;
}

function writeIconTool() {
  ps([
    '-Action', 'write', '-Path', lnkPaths.iconTool, '-Target', POWERSHELL,
    '-Arguments', iconToolArgs(), '-Icon', `${ICON},0`, '-Workdir', ROOT,
    '-WindowStyle', '7', '-Description', '换成 Sol 图标',
  ]);
}

function ensureIcon() {
  if (!existsSync(ICON_SRC)) return false;
  mkdirSync(ICON_DIR, { recursive: true });
  copyFileSync(ICON_SRC, ICON);
  return true;
}

function appProcessCount() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!r.stdout) return 0;
  return r.stdout.split('\n').filter((l) => l.toLowerCase().includes('chatgpt.exe')).length;
}

async function devtools() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function daemonPid() {
  try {
    const pid = Number(readFileSync(path.join(ROOT, 'logs', 'daemon.pid'), 'utf8').trim());
    if (!pid) return 0;
    process.kill(pid, 0);
    return pid;
  } catch {
    return 0;
  }
}

function avProducts() {
  const code = `$out = @()
try { $d = Get-MpComputerStatus -ErrorAction Stop; $out += @{ name='Windows Defender'; enabled = [bool]$d.RealTimeProtectionEnabled } } catch { $out += @{ name='Windows Defender'; enabled = $null } }
try { Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { $out += @{ name=$_.displayName; enabled=('0x' + ('{0:X}' -f $_.productState)) } } } catch {}
$out | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', code], {
    encoding: 'utf8',
    windowsHide: true,
  });
  try {
    const parsed = JSON.parse(r.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function linkMatches(info, extraArgs = '') {
  if (!info.exists) return false;
  const wantTarget = NODE.toLowerCase();
  const wantArgs = linkArgs(extraArgs);
  return (
    String(info.target || '').toLowerCase() === wantTarget &&
    String(info.arguments || '') === wantArgs &&
    String(info.icon || '').toLowerCase() === `${ICON},0`.toLowerCase() &&
    path.resolve(String(info.workdir || '.')) === ROOT
  );
}

// ---------------------------------------------------------------- repair first
if (flag('repair')) {
  const iconOk = ensureIcon();
  check('icon file available', iconOk, iconOk ? ICON : `missing ${ICON_SRC}`);
  if (iconOk && cfg.desktop !== false) {
    writeLink(lnkPaths.desktop);
    check('desktop shortcut written', readLink(lnkPaths.desktop).exists, lnkPaths.desktop);
  }
  if (iconOk && cfg.startMenu !== false) {
    writeLink(lnkPaths.startMenu);
    check('start menu shortcut written', readLink(lnkPaths.startMenu).exists, lnkPaths.startMenu);
    writeIconTool();
  }
  if (cfg.startup) {
    writeLink(lnkPaths.startup, '--background --quiet');
  }
  refreshIconCache();
}

if (autostartArg === 'on' || autostartArg === 'off') {
  if (!lnkPaths.startup) throw new Error('cannot resolve Startup folder');
  if (autostartArg === 'on') {
    ensureIcon();
    writeLink(lnkPaths.startup, '--background --quiet');
    check('autostart installed', readLink(lnkPaths.startup).exists, lnkPaths.startup);
  } else {
    if (existsSync(lnkPaths.startup)) rmSync(lnkPaths.startup, { force: true });
    check('autostart removed', !existsSync(lnkPaths.startup), lnkPaths.startup);
  }
}

// ------------------------------------------------------------------- read-only
const iconPresent = existsSync(ICON_SRC);
check('project icon exists', iconPresent, ICON_SRC);
check('deployed icon exists', existsSync(ICON), ICON);

// Wallpaper library: index.json must list wallpapers that actually exist.
const BG_INDEX = path.join(ROOT, 'assets', 'backgrounds', 'index.json');
let bgEntries = [];
try {
  const parsed = JSON.parse(readFileSync(BG_INDEX, 'utf8'));
  if (Array.isArray(parsed)) bgEntries = parsed;
} catch (err) {
  if (err.code !== 'ENOENT') check('background library readable', false, err.message);
}
const bgMissing = bgEntries.filter((e) => !e || !e.asset || !existsSync(path.join(ROOT, e.asset)));
const bgNames = bgEntries.map((e) => (e && e.name ? String(e.name).trim() : ''));
const bgBytes = bgEntries.reduce((sum, e) => {
  try {
    return sum + statSync(path.join(ROOT, e.asset)).size;
  } catch {
    return sum;
  }
}, 0);
check(
  'background library',
  bgEntries.length > 0 && bgMissing.length === 0,
  `${bgEntries.length} entries, ${(bgBytes / 1024 / 1024).toFixed(1)} MB${bgMissing.length ? `, missing: ${bgMissing.map((e) => e.asset).join(', ')}` : ''}`,
);
check(
  'background names',
  bgEntries.length > 0 && new Set(bgNames).size === bgEntries.length && bgNames.every((n) => n.length > 0),
  `${new Set(bgNames).size}/${bgEntries.length} distinct`,
);

const desktopInfo = readLink(lnkPaths.desktop);
const startMenuInfo = readLink(lnkPaths.startMenu);
const startupInfo = readLink(lnkPaths.startup);

check('desktop shortcut', linkMatches(desktopInfo), lnkPaths.desktop || 'desktop folder not found');
if (desktopInfo.exists && !linkMatches(desktopInfo)) {
  check('  desktop target', false, `target=${desktopInfo.target} args=${desktopInfo.arguments}`);
}
check('start menu shortcut', linkMatches(startMenuInfo), lnkPaths.startMenu);
if (cfg.startMenu !== false) {
  const iconTool = readLink(lnkPaths.iconTool);
  check('Sol icon tool shortcut', iconTool.exists &&
    String(iconTool.target || '').toLowerCase() === POWERSHELL.toLowerCase() &&
    iconTool.arguments === iconToolArgs() && path.resolve(String(iconTool.workdir || '.')) === ROOT, lnkPaths.iconTool);
}
check(
  'autostart entry (optional)',
  !cfg.startup || linkMatches(startupInfo, '--background --quiet'),
  startupInfo.exists ? 'installed' : 'not installed',
);

const procs = appProcessCount();
check('ChatGPT process', procs > 0, procs > 0 ? `${procs} processes` : 'not running', 'runtime');

const version = await devtools();
check('DevTools port', !!version, version ? `${version.Browser} on ${PORT}` : `nothing on 127.0.0.1:${PORT}`, 'runtime');

const dpid = daemonPid();
check('skin daemon', dpid > 0, dpid ? `pid ${dpid}` : 'not running', 'runtime');

if (version) {
  try {
    const { CDP, findShellTarget } = await import(new URL('../src/cdp.mjs', import.meta.url).href);
    const target = await findShellTarget(PORT, {});
    if (target) {
      const cdp = await CDP.connect(target.webSocketDebuggerUrl);
      const state = await cdp.evaluate(
        `({ installed: !!document.getElementById('ccs-skin-style'), marker: document.documentElement.dataset.ccsSkin || null, visibility: document.visibilityState })`,
      );
      cdp.close();
      check('skin injected', state.installed, `marker=${state.marker}`, 'runtime');
      check('window visible', state.visibility === 'visible', state.visibility, 'runtime');
    } else {
      check('ChatGPT main window target', false, 'no app://-/index.html target', 'runtime');
    }
  } catch (err) {
    check('skin probe', false, err.message, 'runtime');
  }
}

const seenAv = new Set();
for (const av of avProducts()) {
  if (!av || !av.name || seenAv.has(av.name)) continue;
  seenAv.add(av.name);
  checks.push({ name: `security software: ${av.name}`, ok: true, detail: `enabled=${av.enabled}`, kind: 'runtime' });
}

// ---------------------------------------------------------------------- output
const entryFails = checks.filter((c) => c.kind !== 'runtime' && !c.ok);
const runtimeFails = checks.filter((c) => c.kind === 'runtime' && !c.ok);
if (jsonMode) {
  console.log(JSON.stringify({ when: new Date().toISOString(), port: PORT, checks, entryFails: entryFails.length, runtimeFails: runtimeFails.length }, null, 2));
} else {
  for (const c of checks) {
    const label = c.ok ? 'PASS' : c.kind === 'runtime' ? 'INFO' : 'FAIL';
    console.log(`${label}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const notes = [];
  if (entryFails.length) notes.push('启动入口有问题：跑 `node tools\\doctor.mjs --repair` 重建快捷方式。');
  if (runtimeFails.length) notes.push('应用/皮肤当前没在运行——双击桌面图标即可带皮肤启动。');
  if (!notes.length) notes.push('一切正常。');
  console.log(`\n${entryFails.length === 0 ? 'OK' : 'FAILED'}: ${checks.length - entryFails.length - runtimeFails.length}/${checks.length} ok${entryFails.length ? `, ${entryFails.length} entry problem(s)` : ''}`);
  for (const n of notes) console.log(n);
}

process.exit(entryFails.length === 0 ? 0 : 1);
