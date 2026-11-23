<#
.SYNOPSIS
  Build dist\chatgpt-mint-skin-v<version>.zip from an explicit include list.

.DESCRIPTION
  Stages the release tree under dist\stage\chatgpt-mint-skin, runs three guards
  (no dev artifacts, no personal paths, no oversized single file), zips it and
  writes dist\SHA256SUMS.txt.

.PARAMETER OutDir
  Output directory, default <repo>\dist

.PARAMETER SkipGuards
  Build even if a guard fails (not recommended).
#>
[CmdletBinding()]
param(
  [string]$OutDir = '',
  [switch]$SkipGuards
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }

$pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$name = 'chatgpt-mint-skin'

$files = @(
  'setup.cmd',
  'set-sol-icon.cmd',
  'restore-stock.cmd',
  'README.md',
  'LICENSE',
  'NOTICE',
  'CHANGELOG.md',
  'package.json',
  '.gitignore',
  '.gitattributes',
  'config/skin.json',
  'config/skin.schema.json',
  'config/shortcut.json',
  'docs/channel.md',
  'docs/dom-map.md',
  'docs/roadmap.md',
  'docs/visual-assets.md',
  'docs/preview/main.webp',
  'docs/preview/assistant.webp',
  'docs/preview/hidden.webp',
  'src/cdp.mjs',
  'src/assets.mjs',
  'src/injector.mjs',
  'src/daemon.mjs',
  'src/runtime/assistant.mjs',
  'src/runtime/sol-actions.mjs',
  'src/runtime/astra.mjs',
  'src/runtime/backgrounds.mjs',
  'src/runtime/browser-pane.mjs',
  'src/runtime/dynamic-scenes.mjs',
  'src/runtime/wallpaper-library.mjs',
  'src/styles/theme.css',
  'src/styles/layers.css',
  'src/styles/appearance.css',
  'src/styles/dynamic-scenes.css',
  'assets/app-icon.ico',
  'assets/background-garden.webp',
  'assets/backgrounds/README.md',
  'assets/backgrounds/index.json',
  'assets/chibi/chibi-happy.webp',
  'assets/chibi/chibi-think.webp',
  'assets/chibi/chibi-cool.webp',
  'assets/chibi/chibi-shy.webp',
  'assets/chibi/chibi-sleepy.webp',
  'assets/chibi/chibi-surprise.webp',
  'assets/dynamic/garden.webp',
  'assets/dynamic/garden-thumb.webp',
  'assets/dynamic/rain.webp',
  'assets/dynamic/rain-thumb.webp',
  'assets/dynamic/fireflies.webp',
  'assets/dynamic/fireflies-thumb.webp',
  'assets/sol/body.webp',
  'assets/sol/pose-blink.webp',
  'assets/sol/pose-wave.webp',
  'assets/sol/pose-think.webp',
  'assets/sol/pose-stretch.webp',
  'assets/sol/pose-cheer.webp',
  'assets/sol/emote-idle.webp',
  'assets/sol/emote-listening.webp',
  'assets/sol/emote-thinking.webp',
  'assets/sol/emote-done.webp',
  'assets/sol/emote-error.webp',
  'assets/sol/emote-hug.webp',
  'tools/setup.ps1',
  'tools/doctor.mjs',
  'tools/launch-skin.mjs',
  'tools/skin-stop.ps1',
  'tools/disable-debug.ps1',
  'tools/show-window.ps1',
  'tools/probe.ps1',
  'tools/set-shortcut-icon.ps1',
  'tools/lib/shortcut.ps1',
  'tools/verify.mjs',
  'tools/diagnose-browser.mjs',
  'tools/screenshot.mjs',
  'tools/eval.mjs',
  'tools/click.mjs',
  'tools/sol-toggle.mjs',
  'tools/assistant-test.mjs',
  'tools/assistant-sim.mjs',
  'tools/assistant-interact.mjs',
  'tools/background-test.mjs',
  'tools/theme-lab.mjs',
  'tools/dom-dump.mjs',
  'tools/find-surfaces.mjs',
  'tools/inspect-el.mjs',
  'tools/blame-color.js',
  'tools/make_chibi.py',
  'tools/make_app_icon.py',
  'tools/make_sol.py',
  'tools/import_backgrounds.py',
  'tools/optimize_assets.py',
  'tools/sample_pixels.py',
  'tools/pack.ps1'
)

$stage = Join-Path $OutDir ('stage\' + $name)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$missing = @()
foreach ($rel in $files) {
  $src = Join-Path $root ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $src)) { $missing += $rel; continue }
  $dst = Join-Path $stage ($rel -replace '/', '\')
  $dir = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
}
if ($missing.Count -gt 0) {
  Write-Host "[pack] missing files:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  $_" }
  if (-not $SkipGuards) { exit 2 }
}

# Wallpaper library has a project-defined size, so copy it wholesale.
$bgDir = Join-Path $root 'assets\backgrounds'
if (Test-Path -LiteralPath $bgDir) {
  $bgStage = Join-Path $stage 'assets\backgrounds'
  if (-not (Test-Path -LiteralPath $bgStage)) { New-Item -ItemType Directory -Path $bgStage -Force | Out-Null }
  Get-ChildItem -LiteralPath $bgDir -Filter '*.webp' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $bgStage $_.Name) -Force
  }
}

# ---- guard 1: no dev artifacts -------------------------------------------------
$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object {
  $rel = $_.FullName.Substring($stage.Length + 1)
  $rel -match '^(logs|shots|recon|dist)\\' -or
  $_.Name -eq 'PROGRESS.md' -or
  $_.Name -like '*-src.png' -or
  $_.Name -like '*.bak-*' -or
  $_.Name -like '*.lnk'
}
if ($forbidden) {
  Write-Host "[pack] guard1 FAILED: dev artifacts in stage" -ForegroundColor Red
  $forbidden | ForEach-Object { Write-Host "  $($_.FullName.Substring($stage.Length + 1))" }
  if (-not $SkipGuards) { exit 3 }
}

# ---- guard 2: no personal paths ------------------------------------------------
$textExt = @('.md', '.mjs', '.js', '.json', '.css', '.ps1', '.cmd', '.py', '.txt', '.html')
$hits = @()
Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object { $textExt -contains $_.Extension.ToLower() } | ForEach-Object {
  $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($text -and ($text -match 'C:\\Users\\[A-Za-z0-9._-]+\\' -and $text -notmatch 'C:\\Users\\<')) {
    $hits += $_.FullName.Substring($stage.Length + 1)
  }
}
if ($hits.Count -gt 0) {
  Write-Host "[pack] guard2 FAILED: personal paths found" -ForegroundColor Red
  $hits | ForEach-Object { Write-Host "  $_" }
  if (-not $SkipGuards) { exit 4 }
}

# ---- guard 3: oversized files --------------------------------------------------
$big = Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object { $_.Length -gt 1.5MB }
if ($big) {
  Write-Host "[pack] guard3 WARNING: files larger than 1.5 MB" -ForegroundColor Yellow
  $big | ForEach-Object { Write-Host ("  {0}  {1:N0} KB" -f $_.FullName.Substring($stage.Length + 1), ($_.Length / 1KB)) }
}

# ---- sanitize local-only settings ---------------------------------------------
$shortcutCfg = Join-Path $stage 'config\shortcut.json'
if (Test-Path -LiteralPath $shortcutCfg) {
  $cfg = Get-Content -LiteralPath $shortcutCfg -Raw | ConvertFrom-Json
  $cfg.proxy = ''
  $cfg | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $shortcutCfg -Encoding utf8
}

# ---- zip + checksums -----------------------------------------------------------
$zip = Join-Path $OutDir ("$name-v$version.zip")
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
$sumFile = Join-Path $OutDir 'SHA256SUMS.txt'
"$hash  $name-v$version.zip" | Set-Content -LiteralPath $sumFile -Encoding ascii

$count = (Get-ChildItem -LiteralPath $stage -Recurse -File).Count
$sizeKb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1KB, 0)
Write-Host ""
Write-Host "[pack] $name v$version" -ForegroundColor Green
Write-Host ("  files : {0}" -f $count)
Write-Host ("  zip   : {0} ({1:N0} KB)" -f $zip, $sizeKb)
Write-Host ("  sha256: {0}" -f $hash)
Write-Host ("  stage : {0}" -f $stage)
