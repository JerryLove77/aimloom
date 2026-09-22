@echo off
setlocal
set "KVK_SCRIPT=%~dp0kvk-config.ps1"
if not exist "%KVK_SCRIPT%" set "KVK_SCRIPT=%~dp0scripts\kvk-config.ps1"
if not exist "%KVK_SCRIPT%" (
  echo Installer files are missing. Extract the whole ZIP and try again.
  pause
  exit /b 1
)
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 or newer is required. Install it, then reopen this window.
  pause
  exit /b 1
)
pwsh.exe -NoProfile -STA -File "%KVK_SCRIPT%" -Mode Restore
set "KVK_EXIT=%ERRORLEVEL%"
if not "%KVK_EXIT%"=="0" if not "%KVK_EXIT%"=="2" (
  echo The operation did not finish successfully. Read the error above.
  echo If PowerShell blocked startup, inspect the trusted package and use
  echo your Windows or organization guidance. No policy was changed.
)
if "%KVK_EXIT%"=="2" echo Cancelled. No further action was started.
pause
exit /b %KVK_EXIT%
