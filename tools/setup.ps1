# One-time setup: create the Sol-icon shortcuts and optionally start the skin.
# ASCII only on purpose: Windows PowerShell 5.1 reads UTF-8 without BOM as ANSI,
# so non-ASCII text in .ps1 files can swallow line breaks and corrupt the script.
#
# Exit codes: 0 ok, 2 Node.js missing, 3 ChatGPT (Store) missing, 4 shortcut write failed.
[CmdletBinding()]
param(
  [string]$Proxy = '',
  [switch]$NoAutostart,
  [switch]$NoLaunch,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $root 'config\shortcut.json'
$alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\chatgpt-desktop.exe'

function Write-Step([string]$text) { Write-Host '' ; Write-Host "== $text" -ForegroundColor Cyan }

Write-Host 'ChatGPT Mint Skin - setup'
Write-Host "project: $root"

Write-Step 'Checking prerequisites'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js not found. Install Node.js 20+ from https://nodejs.org/ and run this again.' -ForegroundColor Red
  exit 2
}
Write-Host "node: $($node.Source)"
if (-not (Test-Path -LiteralPath $alias)) {
  Write-Host 'ChatGPT desktop app not found. Install it from Microsoft Store first.' -ForegroundColor Red
  Write-Host "expected: $alias"
  exit 3
}
Write-Host 'ChatGPT: ok'

Write-Step 'Reading config/shortcut.json'
if (-not (Test-Path -LiteralPath $cfgPath)) {
  Write-Host "missing: $cfgPath" -ForegroundColor Red
  exit 4
}
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
if ($Proxy) {
  $cfg.proxy = $Proxy
  ($cfg | ConvertTo-Json -Depth 6) + "`n" | Set-Content -LiteralPath $cfgPath -Encoding utf8
  Write-Host "proxy saved: $Proxy"
} elseif ($cfg.proxy) {
  Write-Host "proxy: $($cfg.proxy)"
} else {
  Write-Host 'proxy: none (direct connection)'
}
$port = 9335
if ($cfg.port) { $port = [int]$cfg.port }

Write-Step 'Creating shortcuts'
$doctorArgs = @((Join-Path $root 'tools\doctor.mjs'), '--repair', '--port', $port)
if ($cfg.proxy) { $doctorArgs += @('--proxy', $cfg.proxy) }
& $node.Source @doctorArgs
$doctorCode = $LASTEXITCODE
if ($doctorCode -ne 0) {
  Write-Host ''
  Write-Host 'Shortcut creation failed.' -ForegroundColor Red
  Write-Host 'If security software reported a block, review the specific event and check the package checksum.'
  Write-Host 'After resolving the cause, run: node tools\doctor.mjs --repair'
  exit 4
}

if (-not $NoAutostart) {
  Write-Step 'Auto start at login (optional)'
  $answer = 'n'
  if ($Yes) {
    $answer = 'n'
  } else {
    $answer = Read-Host 'Start the skin automatically at login? (y/N)'
  }
  if ($answer -eq 'y' -or $answer -eq 'Y') {
    & $node.Source (Join-Path $root 'tools\doctor.mjs') --autostart on
    Write-Host 'auto start: on'
  } else {
    & $node.Source (Join-Path $root 'tools\doctor.mjs') --autostart off
    Write-Host 'auto start: off'
  }
}

if (-not $NoLaunch) {
  Write-Step 'Starting ChatGPT'
  $launchArgs = @((Join-Path $root 'tools\launch-skin.mjs'), '--port', $port)
  if ($cfg.proxy) { $launchArgs += @('--proxy', $cfg.proxy) }
  & $node.Source @launchArgs
}

Write-Host ''
Write-Host 'Done. Double-click the desktop icon "ChatGPT" any time to open it with the skin.' -ForegroundColor Green
Write-Host 'To restore the stock interface, double-click restore-stock.cmd.'
Write-Host 'To update the icon, use the Sol icon tool in the Start menu or run set-sol-icon.cmd.'
exit 0
