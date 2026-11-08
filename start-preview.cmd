@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or later is required. Install it, then run this file again.
  pause
  exit /b 1
)
echo Starting Daily Motion. Keep this window open while using the preview.
echo Default address: http://127.0.0.1:8787
echo Press Ctrl+C to stop.
node server.mjs
if errorlevel 1 pause
