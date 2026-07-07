@echo off
setlocal

set "WEB_DIR=%~dp0web"
set "CANVAS_URL=http://localhost:3000"

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

echo Starting Canvas Agent in a new window...
start "Infinite Canvas Agent" cmd /k "set CANVAS_URL=%CANVAS_URL%&& npx -y @basketikun/canvas-agent"

echo Starting web dev server...
call npm run dev

pause
