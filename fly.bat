@echo off
rem Start the flighfeel static server (skips silently if already running), then open the game.
rem
rem PORT is set once here and handed to the server, so the listener and the browser cannot
rem disagree. They did: the server moved to 5718 and this file still opened 5717, which is a
rem page that loads nothing. If the port ever dies again, check
rem   netsh interface ipv4 show excludedportrange protocol=tcp
rem and change PORT here and the matching entry in ..\.claude\launch.json.
rem
rem KEEP THIS FILE CRLF. cmd.exe mis-parses LF-only batch files, eating leading characters
rem off most lines - it fails in ways that look like anything except an encoding problem.
set PORT=5718

start "flighfeel server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\.claude\flighfeel-server.ps1" -Port %PORT%

rem Wait until the server actually ANSWERS rather than guessing at a delay. `timeout /t 1` was
rem here and it cannot be used: it needs a real console and dies with "Input redirection is
rem not supported, exiting the process immediately" whenever fly.bat is started with stdin
rem redirected. Polling is also just better - the browser opens when the page is ready.
powershell -NoProfile -Command "$d=[Diagnostics.Stopwatch]::StartNew(); while($d.Elapsed.TotalSeconds -lt 20){ try{ $null = Invoke-WebRequest -Uri 'http://localhost:%PORT%/' -TimeoutSec 1 -UseBasicParsing; exit 0 }catch{ Start-Sleep -Milliseconds 200 } }; exit 1"

if errorlevel 1 (
  echo.
  echo flighfeel: nothing is serving on port %PORT%.
  echo Windows may have put the port in an excluded range again - check with:
  echo    netsh interface ipv4 show excludedportrange protocol=tcp
  echo then set PORT at the top of this file and the port in ..\.claude\launch.json.
  echo.
  pause
  exit /b 1
)

start "" http://localhost:%PORT%/
