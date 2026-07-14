@echo off
setlocal

set "WEB_DIR=%~dp0web"
set "AGENT_DIR=%~dp0canvas-agent"
set "AUDIO_SEPARATOR_DIR=%~dp0audio-separator-service"
set "VOXCPM_SERVICE_DIR=%~dp0voxcpm-service"
set "WEB_PORT=3000"
set "CANVAS_URL=http://127.0.0.1:%WEB_PORT%/"

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
  if exist "%AGENT_DIR%\package.json" (
    if not exist "%AGENT_DIR%\node_modules" (
      echo Installing Canvas Agent dependencies...
      pushd "%AGENT_DIR%"
      call npm install
      if errorlevel 1 (
        popd
        echo Canvas Agent npm install failed.
        pause
        exit /b 1
      )
      popd
    )
    echo Starting local Canvas Agent from source...
    start "Infinite Canvas Agent" /D "%AGENT_DIR%" cmd /k "set CANVAS_URL=%CANVAS_URL%&& npm run dev"
  ) else (
    echo Starting Canvas Agent from npm...
    start "Infinite Canvas Agent" cmd /k "set CANVAS_URL=%CANVAS_URL%&& npx -y @basketikun/canvas-agent"
  )
) else (
  echo Canvas Agent is already running.
)

echo Checking local audio separator...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:17372/health' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%AUDIO_SEPARATOR_DIR%\start-hidden.ps1" (
    echo Starting local audio separator in the background...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%AUDIO_SEPARATOR_DIR%\start-hidden.ps1"
  )
) else (
  echo Local audio separator is already running.
)

echo Checking local VoxCPM service...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8810/health' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%VOXCPM_SERVICE_DIR%\start-hidden.ps1" (
    echo Starting local VoxCPM service in the background...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%VOXCPM_SERVICE_DIR%\start-hidden.ps1"
  )
) else (
  echo Local VoxCPM service is already running.
)

echo Starting web dev server...
call npm run dev -- --port %WEB_PORT%

pause
