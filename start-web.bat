@echo off
setlocal

set "WEB_DIR=%~dp0web"
set "AGENT_DIR=%~dp0canvas-agent"
set "CANVAS_URL=http://127.0.0.1:3000/"

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

echo Checking Canvas Agent...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:17371/health' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%AGENT_DIR%\dist\index.js" (
    echo Starting local Canvas Agent...
    start "Infinite Canvas Agent" /D "%AGENT_DIR%" cmd /k "set CANVAS_URL=%CANVAS_URL%&& node dist\index.js"
  ) else (
    echo Starting Canvas Agent from npm...
    start "Infinite Canvas Agent" cmd /k "set CANVAS_URL=%CANVAS_URL%&& npx -y @basketikun/canvas-agent"
  )
) else (
  echo Canvas Agent is already running.
)

echo Starting web dev server...
call npm run dev

pause
