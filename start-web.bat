@echo off
setlocal

set "WEB_DIR=%~dp0web"
set "AGENT_DIR=%~dp0canvas-agent"
set "AUDIO_SEPARATOR_DIR=%~dp0audio-separator-service"
set "VOICEBOX_START_SCRIPT=%~dp0start-voicebox.ps1"
set "WEB_PORT=3000"
set "CANVAS_URL=http://127.0.0.1:%WEB_PORT%/"

echo ============================================================
echo Infinite Canvas unified launcher
echo   Web              http://127.0.0.1:3000
echo   Canvas Agent     http://127.0.0.1:17371
echo   Audio Separator  http://127.0.0.1:17372
echo   Voicebox         http://127.0.0.1:17493
echo ============================================================
echo.

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
    echo Installing or updating Canvas Agent dependencies...
    pushd "%AGENT_DIR%"
    call npm install
    if errorlevel 1 (
      popd
      echo Canvas Agent npm install failed.
      pause
      exit /b 1
    )
    popd
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

echo Checking local Voicebox service...
if exist "%VOICEBOX_START_SCRIPT%" (
  echo Preparing and starting local Voicebox service...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%VOICEBOX_START_SCRIPT%" -NoBrowser
  if errorlevel 1 (
    echo Voicebox setup or startup failed.
    echo Check voicebox\.runtime\voicebox-error.log and the messages above.
    pause
    exit /b 1
  )
) else (
  echo Cannot find start-voicebox.ps1.
  pause
  exit /b 1
)

echo.
echo All local services have been checked or started by this launcher.
echo Canvas:   http://127.0.0.1:%WEB_PORT%/
echo Voicebox: http://127.0.0.1:17493/
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%CANVAS_URL%' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Web dev server is already running. Opening the canvas...
  start "" "%CANVAS_URL%"
  exit /b 0
)

echo Starting web dev server...
start "" "%CANVAS_URL%"
call npm run dev -- --port %WEB_PORT%

pause
