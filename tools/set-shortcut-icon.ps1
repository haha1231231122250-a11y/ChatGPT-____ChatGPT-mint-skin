<#
.SYNOPSIS
  Apply the bundled Sol icon to existing Mint Skin shortcuts.
.NOTES
  With no -Link parameter, only shortcuts managed by Mint Skin are selected.
  The explicit -Link parameter still supports updating a user-selected .lnk.
#>
[CmdletBinding()]
param(
  [string]$Link = '',
  [string]$Icon = '',
  [switch]$ShowResult
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$lib = Join-Path $PSScriptRoot 'lib\shortcut.ps1'

function Show-IconResult([string]$message, [bool]$success) {
  if (!$ShowResult) { return }
  Add-Type -AssemblyName System.Windows.Forms
  $kind = if ($success) { 'Information' } else { 'Warning' }
  [void][System.Windows.Forms.MessageBox]::Show($message, '换成 Sol 图标', 'OK', $kind)
}

function Test-MintShortcut($shortcut) {
  if (!$shortcut.exists -or ([IO.Path]::GetFileName($shortcut.target) -ne 'node.exe')) { return $false }
  if ($shortcut.arguments -notmatch '^(?:"([^"]+)"|([^ ]+))') { return $false }
  $launcher = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  if ($launcher -notmatch '[\\/]tools[\\/]launch-skin\.mjs$' -or !(Test-Path -LiteralPath $launcher -PathType Leaf)) { return $false }
  $project = Split-Path -Parent (Split-Path -Parent $launcher)
  try {
    return (Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json).name -eq 'chatgpt-mint-skin'
  } catch {
    return $false
  }
}

try {
  if (!$Icon) { $Icon = Join-Path $root 'assets\app-icon.ico' }
  $Icon = (Resolve-Path -LiteralPath $Icon).Path
  $cfg = Get-Content -LiteralPath (Join-Path $root 'config\shortcut.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $name = if ($cfg.name) { $cfg.name } else { 'ChatGPT' }
  $requested = if ($Link) { @($Link) } else {
    @(
      Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"
      Join-Path ([Environment]::GetFolderPath('Programs')) "$name Mint Skin.lnk"
    )
  }
  $matchesFound = @(
    foreach ($candidate in $requested) {
      if (!(Test-Path -LiteralPath $candidate -PathType Leaf) -or [IO.Path]::GetExtension($candidate) -ne '.lnk') { continue }
      $full = (Resolve-Path -LiteralPath $candidate).Path
      $info = & $lib -Action read -Path $full | ConvertFrom-Json
      if ($Link -or (Test-MintShortcut $info)) { $info }
    }
  )
  if (!$matchesFound.Count) { throw '找不到可更新的美化版快捷方式。请先运行 setup.cmd。' }

  $stableDir = Join-Path $env:LOCALAPPDATA 'chatgpt-mint-skin'
  New-Item -ItemType Directory -Path $stableDir -Force | Out-Null
  $stableIcon = Join-Path $stableDir 'app-icon.ico'
  if ($Icon -ne $stableIcon) { Copy-Item -LiteralPath $Icon -Destination $stableIcon -Force }
  foreach ($before in $matchesFound) {
    $null = & $lib -Action icon -Path $before.path -Icon "$stableIcon,0"
    $after = & $lib -Action read -Path $before.path | ConvertFrom-Json
    if (!$after.exists -or $after.icon -ne "$stableIcon,0" -or $after.target -cne $before.target -or
        $after.arguments -cne $before.arguments -or $after.workdir -cne $before.workdir) {
      throw "无法验证快捷方式更新：$($before.path)"
    }
    Write-Host "已应用 Sol 图标：$($before.path)" -ForegroundColor Green
  }
  $null = & $lib -Action iconcache
  Show-IconResult "已为 $($matchesFound.Count) 个快捷方式应用 Sol 图标。" $true
} catch {
  if ($ShowResult) { Show-IconResult $_.Exception.Message $false }
  Write-Error $_
  exit 1
}

