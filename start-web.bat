@echo off
setlocal

set "WEB_DIR=%~dp0web"
set "AGENT_DIR=%~dp0canvas-agent"
set "AUDIO_SEPARATOR_DIR=%~dp0audio-separator-service"
set "VOXCPM_SERVICE_DIR=%~dp0voxcpm-service"
set "VOICEBOX_START_SCRIPT=%~dp0start-voicebox.ps1"
set "JELLYFISH_DIR=%~dp0Jellyfish"
set "JELLYFISH_FRONT_DIR=%JELLYFISH_DIR%\front"
set "JELLYFISH_BACKEND_DIR=%JELLYFISH_DIR%\backend"
set "WEB_PORT=3000"
set "CANVAS_URL=http://127.0.0.1:%WEB_PORT%/"

echo ============================================================
echo Infinite Canvas unified launcher
echo   Web              http://127.0.0.1:3000
echo   Canvas Agent     http://127.0.0.1:17371
echo   Audio Separator  http://127.0.0.1:17372
echo   VoxCPM           http://127.0.0.1:8810
echo   Voicebox         http://127.0.0.1:17493
echo   Jellyfish        http://127.0.0.1:7788 (API http://127.0.0.1:8000)
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

echo Checking Jellyfish backend...
echo Jellyfish uses a project-local background worker by default; Docker/Redis is optional.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%JELLYFISH_BACKEND_DIR%\pyproject.toml" (
    if not exist "%JELLYFISH_BACKEND_DIR%\.env" copy /Y "%JELLYFISH_BACKEND_DIR%\.env.example" "%JELLYFISH_BACKEND_DIR%\.env" >nul
    echo Starting Jellyfish backend...
    start "Jellyfish Backend" /D "%JELLYFISH_BACKEND_DIR%" cmd /k "uv sync&&uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
  ) else echo Jellyfish backend files not found.
) else echo Jellyfish backend is already running.

echo Jellyfish local task worker runs inside the backend process.

echo Checking Jellyfish frontend...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://localhost:7788' -UseBasicParsing -TimeoutSec 2 > $null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%JELLYFISH_FRONT_DIR%\package.json" (
    if not exist "%JELLYFISH_FRONT_DIR%\node_modules" (
      echo Installing Jellyfish frontend dependencies...
      pushd "%JELLYFISH_FRONT_DIR%"
      where pnpm >nul 2>nul
      if not errorlevel 1 (call pnpm install --frozen-lockfile) else (
        echo Jellyfish frontend requires pnpm because pnpm-lock.yaml is committed.
        echo Install pnpm 9.15.9, then rerun start-web.bat.
        popd
        pause
        exit /b 1
      )
      if errorlevel 1 (
        popd
        echo Jellyfish frontend dependency install failed.
        pause
        exit /b 1
      )
      popd
    )
    echo Starting Jellyfish frontend...
    start "Jellyfish Frontend" /D "%JELLYFISH_FRONT_DIR%" cmd /k "npm run dev -- --host 0.0.0.0 --port 7788 --open false"
  ) else echo Jellyfish frontend files not found.
) else echo Jellyfish frontend is already running.

echo.
echo All local services have been checked or started by this launcher.
echo Canvas:   http://127.0.0.1:%WEB_PORT%/
echo Voicebox: http://127.0.0.1:17493/
echo Jellyfish: http://127.0.0.1:7788/
echo.
echo Starting web dev server...
call npm run dev -- --port %WEB_PORT%

pause
