@echo off
rem SHARP CLOUDS - cloud buffer at 0.8 of screen instead of the usual 0.45.
rem Roughly 3x the raymarch pixels, so expect a big frame-time hit; the point is to see
rem how much of the softness is buffer resolution and how much is the density field.
rem If something still looks wrong at 0.8, resolution is not the answer to it.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?cloudres=0.8"
