<#
.SYNOPSIS
  Single implementation of "write / read / refresh" for the project's .lnk files.
  Called by tools/doctor.mjs and the legacy PowerShell helpers; keep the COM logic here.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\lib\shortcut.ps1 -Action write `
    -Path "<Desktop>\ChatGPT.lnk" -Target "C:\Program Files\nodejs\node.exe" `
    -Arguments '"<project>\tools\launch-skin.mjs" --port 9335' `
    -Icon "<LocalAppData>\chatgpt-mint-skin\app-icon.ico,0" `
    -WorkDir "<project>" -WindowStyle 7 -Description "Launch ChatGPT with the mint skin"
#>
[CmdletBinding()]
param(
  [ValidateSet('write', 'read', 'icon', 'iconcache')]
  [string]$Action = 'write',
  [string]$Path = '',
  [string]$Target = '',
  [string]$Arguments = '',
  [string]$Icon = '',
  [string]$WorkDir = '',
  [int]$WindowStyle = 1,
  [string]$Description = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

switch ($Action) {
  'iconcache' {
    # Ask Explorer to rebuild its icon cache so a replaced .ico shows up immediately.
    & ie4uinit.exe -show 2>$null | Out-Null
    Write-Output '{"ok":true,"action":"iconcache"}'
    break
  }
  'read' {
    if (-not (Test-Path -LiteralPath $Path)) {
      Write-Output '{"exists":false}'
      break
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $obj = [ordered]@{
      exists    = $true
      path      = $Path
      target    = $link.TargetPath
      arguments = $link.Arguments
      icon      = $link.IconLocation
      workdir   = $link.WorkingDirectory
      style     = $link.WindowStyle
      size      = (Get-Item -LiteralPath $Path).Length
    }
    ConvertTo-Json -InputObject $obj -Compress
    break
  }
  'icon' {
    # Change only the icon of an existing .lnk (keeps its target/arguments untouched).
    if (-not $Path -or -not $Icon) { throw 'icon requires -Path and -Icon' }
    if (-not (Test-Path -LiteralPath $Path)) { Write-Output '{"exists":false}'; break }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.IconLocation = $Icon
    $link.Save()
    $out = [ordered]@{ ok = $true; path = $Path; icon = $Icon }
    ConvertTo-Json -InputObject $out -Compress
    break
  }
  default {
    if (-not $Path -or -not $Target) { throw 'write requires -Path and -Target' }
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $Target
    if ($Arguments) { $link.Arguments = $Arguments }
    if ($Icon) { $link.IconLocation = $Icon }
    if ($WorkDir) { $link.WorkingDirectory = $WorkDir }
    $link.WindowStyle = $WindowStyle
    if ($Description) { $link.Description = $Description }
    $link.Save()
    $out = [ordered]@{ ok = $true; path = $Path; size = (Get-Item -LiteralPath $Path).Length }
    ConvertTo-Json -InputObject $out -Compress
  }
}
