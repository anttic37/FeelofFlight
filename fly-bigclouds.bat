@echo off
rem BIGGER CLOUDS - weather tile 60 instead of 120, so every blob is twice the size in
rem world terms. This is the ONE control over cloud size; coverage changes size and count
rem together, which is why it is not the knob for this.
rem Note the island mask scales with it automatically, so the cap still fits the island.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?wrepeat=60"
