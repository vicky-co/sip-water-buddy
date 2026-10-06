@echo off
setlocal
title Install Sip Water Buddy
set "SRC=%~dp0"
set "APP=%LOCALAPPDATA%\Programs\SipWaterBuddy"
echo.
if not exist "%SRC%Sip Water Buddy.exe" (
  echo  Please extract the whole zip first ^(right-click the zip, Extract All^),
  echo  then run Install.bat from the extracted folder.
  echo.
  pause
  exit /b 1
)
echo  Installing Sip Water Buddy...
taskkill /f /im "Sip Water Buddy.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
if not exist "%APP%" mkdir "%APP%"
rem /PURGE removes old program files from earlier versions; your settings live in %APPDATA%\sip-water-buddy and are kept
robocopy "%SRC%." "%APP%" /MIR /XF Install.bat /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo  Copying failed. Close any running copy of Sip and try again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$app=Join-Path $env:LOCALAPPDATA 'Programs\SipWaterBuddy'; $s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Sip Water Buddy.lnk')); $l.TargetPath=(Join-Path $app 'Sip Water Buddy.exe'); $l.WorkingDirectory=$app; $l.IconLocation=(Join-Path $app 'icon.ico'); $l.Description='Sip Water Buddy'; $l.Save()"
start "" "%APP%\Sip Water Buddy.exe"
echo.
echo  Done. Sip is running: look for the water-drop icon near the clock
echo  ^(click the ^^ arrow if it is hidden^). Double-click it to open Settings.
echo  It starts by itself when you sign in ^(you can turn that off in Settings^).
echo  You can delete this folder now.
echo.
timeout /t 8 >nul
