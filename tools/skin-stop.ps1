<#
.SYNOPSIS
  Removes the mint skin and stops the background daemon.

.DESCRIPTION
  The skin lives entirely inside the running page, so unloading it restores the
  stock ChatGPT UI immediately. Use -CloseApp to also quit the app afterwards
  (the next normal launch no longer exposes a DevTools port unless you use the
  start script again).

.PARAMETER CloseApp
  Quit ChatGPT after the skin has been removed.
#>
[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$CloseApp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'logs\daemon.pid'
if (-not $PSBoundParameters.ContainsKey('Port')) {
  $shortcutConfig = Join-Path $root 'config\shortcut.json'
  if (Test-Path -LiteralPath $shortcutConfig) {
    $configuredPort = (Get-Content -LiteralPath $shortcutConfig -Raw -Encoding UTF8 | ConvertFrom-Json).port
    if ($configuredPort) { $Port = [int]$configuredPort }
  }
}

function Test-DevTools {
  param([int]$p)
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$p/json/version" -TimeoutSec 2
    return $true
  } catch {
    return $false
  }
}

if (Test-Path -LiteralPath $pidFile) {
  $daemonPid = (Get-Content -LiteralPath $pidFile | Select-Object -First 1)
  if ($daemonPid -as [int]) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$daemonPid)"
    $daemonPath = Join-Path $root 'src\daemon.mjs'
    if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match [regex]::Escape($daemonPath)) {
      Write-Host "[skin] stopping daemon (pid $daemonPid)"
      Stop-Process -Id ([int]$daemonPid) -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 400
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[skin] no daemon pid file; nothing to stop"
}

if (Test-DevTools -p $Port) {
  Write-Host "[skin] removing the skin from the running window"
  & node (Join-Path $root 'tools\theme-lab.mjs') --uninstall --port $Port
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "[skin] DevTools not reachable; the app is already clean or closed"
}

if ($CloseApp) {
  $running = @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    Write-Host "[skin] closing ChatGPT"
    $running | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
    Start-Sleep -Seconds 2
    Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "[skin] done. Start again with: node tools\launch-skin.mjs" -ForegroundColor Green

