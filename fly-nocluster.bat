@echo off
rem NO DISTRICT CLUSTERING. Leaves the generated weather map exactly as the library made
rem it - no quiet districts held down, no active ones merged.
rem The sky comes out fuller and more uniform, because suppressing the quiet districts is
rem what opens the gaps. Use it to tell a clustering artifact from a weather-field one.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?cluster=0"
