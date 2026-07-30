@echo off
rem Shared by every fly*.bat: starts the static server if it is not already up.
rem Binding fails silently and harmlessly when a server is already listening on 5717.
start "flighfeel server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\.claude\flighfeel-server.ps1"
timeout /t 1 /nobreak >nul
