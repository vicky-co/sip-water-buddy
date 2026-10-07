@echo off
setlocal
title Sip Water Buddy
cd /d "%~dp0"
rem Runs Sip straight from this project folder. No installer and no downloaded .exe are involved:
rem Node.js fetches the Electron runtime itself the first time, which avoids the "unknown publisher" block on downloaded programs.
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js 20 or newer is needed to run Sip from this folder.
  echo  Install it from https://nodejs.org ^(the LTS button^) or run:  winget install OpenJS.NodeJS.LTS
  echo  Then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo  First run: setting things up ^(needs internet, takes a minute^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist "src\renderer\vendor\three-bundle.js" call npm run build:vendor
echo  Starting Sip... look for the water-drop icon near the clock ^(click the ^^ arrow if hidden^).
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath npm.cmd -ArgumentList 'start' -WorkingDirectory '%~dp0'"
timeout /t 5 >nul
