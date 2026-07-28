@echo off
rem Start the flighfeel static server (skips silently if already running), then open the game.
start "flighfeel server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\.claude\flighfeel-server.ps1"
timeout /t 1 /nobreak >nul
start "" http://localhost:5717/
