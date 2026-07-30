@echo off
rem NO VOLUMETRIC CLOUDS. Falls back to the plain composer and the sky dome alone.
rem The whole post chain changes with it - the volumetric path owns bloom, tone mapping
rem and MSAA - so this is the baseline for "is the clouds module responsible at all",
rem and also the fastest way to look at terrain work without the cloud cost.
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?vclouds=0"
