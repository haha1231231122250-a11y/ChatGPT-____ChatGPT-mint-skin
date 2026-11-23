@echo off
setlocal
chcp 65001 >nul

rem ChatGPT Mint Skin - one click setup.
rem Creates a Sol-icon shortcut on the desktop and in the Start menu, then starts the app.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js not found. Install Node.js 20+ from https://nodejs.org/ and run setup.cmd again.
  echo.
  pause
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\setup.ps1" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo Setup failed with exit code %CODE%. See the messages above.
  pause
)

exit /b %CODE%
