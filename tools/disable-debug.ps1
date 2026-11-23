<#
.SYNOPSIS
  Full uninstall of the mint skin: stop daemon, remove skin, optionally close the app
  and delete the desktop shortcut.

.DESCRIPTION
  Nothing is written into the ChatGPT installation directory, so "uninstall" is just
  cleaning up local state: no injected code survives a restart, and the store app keeps
  working exactly as before.
#>
[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$CloseApp,
  [switch]$KeepShortcut
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ChatGPT Mint Skin.lnk'

& (Join-Path $PSScriptRoot 'skin-stop.ps1') -Port $Port -CloseApp:$CloseApp

if (-not $KeepShortcut -and (Test-Path -LiteralPath $shortcut)) {
  Remove-Item -LiteralPath $shortcut -Force
  Write-Host "[skin] removed shortcut: $shortcut"
}

Write-Host "[skin] uninstalled. ChatGPT can be started normally (no debug port)." -ForegroundColor Green
