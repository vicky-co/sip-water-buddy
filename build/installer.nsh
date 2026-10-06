; Extra steps for the Windows installer (electron-builder / NSIS).
!macro customUnInstall
  ; Sip registers its own "start when I sign in" entry. Remove it when uninstalling.
  ; (Settings and reminders in %APPDATA%\sip-water-buddy are kept, so a reinstall picks up where you left off.)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.sip.waterbuddy"
!macroend
