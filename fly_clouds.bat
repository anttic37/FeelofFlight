@echo off
rem Same as fly.bat but opens the VOLUMETRIC CLOUD spike (?vclouds=1).
rem Raymarched clouds via @takram/three-clouds, with the atmosphere's sun and
rem sky luminance scaled 8x so they read white against this scene's exposure.
rem Costs about +0.9 ms/frame over the normal build. The packages come off a
rem CDN, so the sky stays empty for a few seconds while they load - that is the
rem loading, not a bug. Normal play: use fly.bat.
start "flighfeel server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\.claude\flighfeel-server.ps1"
timeout /t 1 /nobreak >nul
start "" "http://localhost:5717/?vclouds=1"
