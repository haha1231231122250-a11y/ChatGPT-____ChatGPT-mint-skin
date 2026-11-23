<#
.SYNOPSIS
  Force the ChatGPT window back on screen (restore / show / bring to front).

.DESCRIPTION
  Handles the three states the desktop app can be in without restarting it:
    - minimized  -> SW_RESTORE
    - hidden     -> SW_SHOW
    - in front   -> just focus
  A plainly hidden (tray) window may keep its renderer frozen. Open it from the
  system tray if automation cannot show it.

.PARAMETER Quiet
  Do not print anything.
#>
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'

if (-not ('CcsShowWindow' -as [type])) {
  Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CcsShowWindow {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static int Restored = 0;
  public static int Shown = 0;
  public static int Total = 0;
  public static void Apply(HashSet<uint> pids) {
    Restored = 0; Shown = 0; Total = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      Total++;
      bool vis = IsWindowVisible(h);
      bool icon = IsIconic(h);
      if (icon) {
        ShowWindow(h, 9);          // SW_RESTORE
        Restored++;
        SetForegroundWindow(h);
      } else if (!vis) {
        ShowWindow(h, 5);          // SW_SHOW
        ShowWindow(h, 9);
        Shown++;
        SetForegroundWindow(h);
      } else {
        SetForegroundWindow(h);
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
}

$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }

if ($pids.Count -eq 0) {
  if (-not $Quiet) { Write-Host '[skin] ChatGPT is not running' }
  exit 2
}

[CcsShowWindow]::Apply($pids)

if (-not $Quiet) {
  Write-Host "[skin] windows: $([CcsShowWindow]::Total), restored: $([CcsShowWindow]::Restored), shown: $([CcsShowWindow]::Shown)"
}

if ([CcsShowWindow]::Total -eq 0) { exit 3 }
exit 0
