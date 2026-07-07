@echo off
setlocal

set "WEB_DIR=%~dp0web"

if not exist "%WEB_DIR%\package.json" (
  echo Cannot find web\package.json.
  echo Please put this file in the project root.
  pause
  exit /b 1
)

cd /d "%WEB_DIR%"

echo Installing or updating web dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo Starting web dev server...
call npm run dev

pause
