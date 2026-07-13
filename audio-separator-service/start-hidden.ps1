$ErrorActionPreference = "Stop"

$serviceDir = $PSScriptRoot
$pythonw = Join-Path $serviceDir ".venv\Scripts\pythonw.exe"
$installMarker = Join-Path $serviceDir ".installing"
$logDir = Join-Path $serviceDir "logs"

try {
    Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:17372/health" -TimeoutSec 2 | Out-Null
    exit 0
} catch {}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (-not (Test-Path $pythonw)) {
    if (-not (Test-Path $installMarker)) {
        $bootstrapScript = Join-Path $serviceDir "bootstrap.ps1"
        Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$bootstrapScript`"" -RedirectStandardOutput (Join-Path $logDir "bootstrap.log") -RedirectStandardError (Join-Path $logDir "bootstrap-error.log")
    }
    exit 0
}

$serviceScript = Join-Path $serviceDir "service.py"
Start-Process $pythonw -WindowStyle Hidden -WorkingDirectory $serviceDir -ArgumentList "`"$serviceScript`""
