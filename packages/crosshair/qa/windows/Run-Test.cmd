@echo off
setlocal DisableDelayedExpansion
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 is required. Please install it or ask for help.
  pause
  exit /b 2
)
pwsh.exe -NoLogo -NoProfile -File "%~dp0Crosshair-Test.ps1" %*
set "AimloomExitCode=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %AimloomExitCode%
