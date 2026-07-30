@echo off
rem RAW WEATHER FIELD - both bakes off at once, mask and clustering.
rem This is the library's own generated map with nothing of ours applied, so anything
rem still wrong in the sky here belongs to the cloud layers or the raymarch, not to the
rem weather map we write into.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?cap=0&cluster=0"
