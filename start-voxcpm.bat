@echo off
setlocal

set "ROOT=%~dp0"
if not defined VOXCPM_DIR set "VOXCPM_DIR=%ROOT%..\..\VoxCPM"
if not defined VOXCPM_RUNTIME_DIR set "VOXCPM_RUNTIME_DIR=%ROOT%voxcpm-service\.runtime"
if not defined VOXCPM_HOST set "VOXCPM_HOST=127.0.0.1"
if not defined VOXCPM_PORT set "VOXCPM_PORT=8810"
if not defined VOXCPM_DEVICE set "VOXCPM_DEVICE=cuda"
if not defined SETUPTOOLS_SCM_PRETEND_VERSION_FOR_VOXCPM set "SETUPTOOLS_SCM_PRETEND_VERSION_FOR_VOXCPM=0.0.0"
set "VOXCPM_PYTHON=%VOXCPM_DIR%\.venv\Scripts\python.exe"
set "HF_HOME=%VOXCPM_RUNTIME_DIR%\huggingface"
set "HF_HUB_CACHE=%HF_HOME%\hub"
set "HUGGINGFACE_HUB_CACHE=%HF_HOME%\hub"
set "HF_DATASETS_CACHE=%HF_HOME%\datasets"
set "TRANSFORMERS_CACHE=%HF_HOME%\transformers"
set "MODELSCOPE_CACHE=%VOXCPM_RUNTIME_DIR%\modelscope"
set "TORCH_HOME=%VOXCPM_RUNTIME_DIR%\torch"
set "UV_CACHE_DIR=%VOXCPM_RUNTIME_DIR%\uv-cache"
set "XDG_CACHE_HOME=%VOXCPM_RUNTIME_DIR%\cache"
set "TMP=%VOXCPM_RUNTIME_DIR%\temp"
set "TEMP=%VOXCPM_RUNTIME_DIR%\temp"

if not exist "%VOXCPM_RUNTIME_DIR%\temp" mkdir "%VOXCPM_RUNTIME_DIR%\temp"
if not exist "%VOXCPM_RUNTIME_DIR%\outputs" mkdir "%VOXCPM_RUNTIME_DIR%\outputs"

if not exist "%VOXCPM_DIR%\pyproject.toml" (
    echo VoxCPM project not found: %VOXCPM_DIR%
    echo Set VOXCPM_DIR to the local VoxCPM directory and try again.
    exit /b 1
)

where uv >nul 2>nul
if errorlevel 1 (
    echo uv is required. Install uv and try again.
    exit /b 1
)

if not exist "%VOXCPM_PYTHON%" goto install_dependencies
"%VOXCPM_PYTHON%" -c "import voxcpm, fastapi, uvicorn" >nul 2>nul
if errorlevel 1 goto install_dependencies
goto check_cuda

:install_dependencies
uv sync --project "%VOXCPM_DIR%" --python 3.11
if errorlevel 1 exit /b 1

:check_cuda
if /I "%VOXCPM_DEVICE%"=="cpu" goto start_service
"%VOXCPM_PYTHON%" -c "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)" >nul 2>nul
if not errorlevel 1 goto start_service
echo Installing PyTorch CUDA 12.8 runtime...
uv pip install --python "%VOXCPM_PYTHON%" --reinstall torch==2.10.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 exit /b 1

:start_service
"%VOXCPM_PYTHON%" "%ROOT%voxcpm-service\server.py" --host "%VOXCPM_HOST%" --port "%VOXCPM_PORT%"
