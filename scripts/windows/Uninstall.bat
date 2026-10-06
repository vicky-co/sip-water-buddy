@echo off
setlocal
title Uninstall Sip Water Buddy
set "APP=%LOCALAPPDATA%\Programs\SipWaterBuddy"
echo.
echo  This removes Sip Water Buddy, its Start menu entry, its start-at-sign-in
echo  setting and its saved data ^(reminders, names, glass counts, added avatars, pets and sounds^).
echo.
choice /m "Continue"
if errorlevel 2 exit /b
taskkill /f /im "Sip Water Buddy.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Sip Water Buddy.lnk') -ErrorAction SilentlyContinue; $k='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -like '*Sip Water Buddy.exe*' } | ForEach-Object { Remove-ItemProperty -Path $k -Name $_.Name -ErrorAction SilentlyContinue }"
rmdir /s /q "%APPDATA%\sip-water-buddy" 2>nul
echo.
echo  Removed. You can also delete the folder you extracted.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & rmdir /s /q "%APP%""
timeout /t 4 >nul
