@echo off
REM Starts the Vite dev server. Resolves the app folder relative to this
REM script, so it works from any clone location.
cd /d "%~dp0app"
start cmd /k "npm run dev"
