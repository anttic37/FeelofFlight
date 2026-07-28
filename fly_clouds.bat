@echo off
rem Same as fly.bat but opens the VOLUMETRIC CLOUD spike (?vclouds=1).
rem Heads up: the clouds render, but they come out muddy grey - the takram
rem atmosphere emits physical luminance and wants an exposure around 10, while
rem this scene is authored for 1.15. This is for judging the STYLE of cloud,
rem not the colour. Loading the packages off the CDN takes a few seconds, so
rem the sky stays empty at first. Normal play: use fly.bat.
start "flighfeel server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\.claude\flighfeel-server.ps1"
timeout /t 1 /nobreak >nul
start "" "http://localhost:5717/?vclouds=1"
