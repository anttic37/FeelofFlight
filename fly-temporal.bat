@echo off
rem OLD TEMPORAL RECONSTRUCTION. Puts back the library default: 1/16 of the cloud pixels
rem rendered per frame and the rest reprojected from the previous frame.
rem Cheaper, but it is where the sprayed grain came from, and it smears anything that
rem does not move with the world. Side by side against the normal build this is the
rem clearest way to see what the history costs in image quality.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?nohist=0"
