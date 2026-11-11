@echo off
rem Commander Forge for Windows: double-click to start. Close this window or press Ctrl+C to stop.
title Commander Forge
cd /d "%~dp0"
"%~dp0node\node.exe" "%~dp0launcher.mjs" %*
if errorlevel 1 (
  echo.
  echo Commander Forge stopped with an error.
  pause
)
