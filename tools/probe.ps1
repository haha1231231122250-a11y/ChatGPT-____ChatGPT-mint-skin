<#
.SYNOPSIS
  Prints the DevTools endpoint and every debuggable target of the ChatGPT window.
#>
[CmdletBinding()]
param([int]$Port = 9335)

function Get-Json {
  param([string]$Uri)
  try { return Invoke-RestMethod -Uri $Uri -TimeoutSec 2 } catch { return $null }
}

$version = Get-Json "http://127.0.0.1:$Port/json/version"
if (-not $version) {
  Write-Host "No DevTools endpoint on 127.0.0.1:$Port." -ForegroundColor Yellow
  Write-Host "Start the app with: node tools\launch-skin.mjs"
  exit 1
}

Write-Host "Browser : $($version.Browser)"
Write-Host "Debugger: $($version.'webSocketDebuggerUrl')"
Write-Host "Targets :"
$targets = @(Get-Json "http://127.0.0.1:$Port/json/list")
foreach ($t in $targets) {
  Write-Host ("  {0,-9} {1}" -f $t.type, $t.url)
}

