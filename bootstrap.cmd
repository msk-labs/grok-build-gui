@echo off
setlocal

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. 1>&2
  exit /b 1
)

node.exe "%~dp0scripts\bootstrap.mjs" %*
exit /b %errorlevel%
