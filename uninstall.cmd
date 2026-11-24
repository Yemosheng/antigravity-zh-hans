@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 18+ is required: https://nodejs.org
  echo.
  pause
  exit /b 1
)
node "src\uninstall.js" --force %*
if errorlevel 1 (
  echo.
  echo Uninstall failed - see the messages above.
  pause
)
endlocal