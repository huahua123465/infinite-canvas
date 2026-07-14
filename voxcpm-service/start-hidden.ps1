$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $PSScriptRoot "logs"
$launcher = Join-Path $root "start-voxcpm.bat"

try {
    Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8810/health" -TimeoutSec 2 | Out-Null
    exit 0
} catch {}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Process $env:ComSpec -WindowStyle Hidden -WorkingDirectory $root -ArgumentList "/d /c call `"$launcher`"" -RedirectStandardOutput (Join-Path $logDir "service.log") -RedirectStandardError (Join-Path $logDir "service-error.log")
