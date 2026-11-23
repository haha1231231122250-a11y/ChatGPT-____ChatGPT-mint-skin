@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\set-shortcut-icon.ps1" -ShowResult
exit /b %ERRORLEVEL%
