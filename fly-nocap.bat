@echo off
rem NO ISLAND MASK. Skips applyIslandCap, so the weather map is unmasked and the deck
rem covers the whole sky instead of sitting over the island.
rem Use it to decide whether a straight edge is the mask boundary: if the edge survives
rem this, it is not the mask. (It did survive, which is how the mask was ruled out.)
call "%~dp0_serve.bat"
start "" "http://localhost:5717/?cap=0"
