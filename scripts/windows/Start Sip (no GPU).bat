@echo off
rem Use this if Sip shows a black box instead of a see-through background.
taskkill /f /im "Sip Water Buddy.exe" >nul 2>&1
set SIP_NO_GPU=1
start "" "%~dp0Sip Water Buddy.exe"
