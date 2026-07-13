$ErrorActionPreference = "Stop"

$serviceDir = $PSScriptRoot
$runtimeDir = Join-Path $serviceDir ".runtime"
$venvDir = Join-Path $serviceDir ".venv"
$logDir = Join-Path $serviceDir "logs"
$installMarker = Join-Path $serviceDir ".installing"
$uvExe = Join-Path $runtimeDir "uv.exe"
$ffmpegExe = Join-Path $runtimeDir "ffmpeg.exe"

New-Item -ItemType Directory -Force -Path $runtimeDir, $logDir | Out-Null
New-Item -ItemType File -Force -Path $installMarker | Out-Null

try {
    if (-not (Test-Path $uvExe)) {
        $uvZip = Join-Path $runtimeDir "uv.zip"
        Invoke-WebRequest -UseBasicParsing "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" -OutFile $uvZip
        Expand-Archive -Force $uvZip $runtimeDir
        Remove-Item $uvZip -Force
        $downloadedUv = Get-ChildItem $runtimeDir -Recurse -Filter "uv.exe" | Select-Object -First 1
        if (-not $downloadedUv) { throw "uv.exe 下载失败" }
        if ($downloadedUv.FullName -ne $uvExe) { Copy-Item $downloadedUv.FullName $uvExe -Force }
    }

    if (-not (Test-Path $ffmpegExe)) {
        $ffmpegZip = Join-Path $runtimeDir "ffmpeg.zip"
        $ffmpegExtract = Join-Path $runtimeDir "ffmpeg"
        Invoke-WebRequest -UseBasicParsing "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip
        Expand-Archive -Force $ffmpegZip $ffmpegExtract
        Remove-Item $ffmpegZip -Force
        $downloadedFfmpeg = Get-ChildItem $ffmpegExtract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
        if (-not $downloadedFfmpeg) { throw "ffmpeg.exe 下载失败" }
        Copy-Item $downloadedFfmpeg.FullName $ffmpegExe -Force
        Remove-Item $ffmpegExtract -Recurse -Force
    }

    & $uvExe python install 3.11
    if (-not (Test-Path (Join-Path $venvDir "Scripts\python.exe"))) {
        & $uvExe venv --python 3.11 $venvDir
    }
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    & $uvExe pip install --python $venvPython -r (Join-Path $serviceDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "audio-separator 安装失败" }
    & $uvExe pip install --python $venvPython --reinstall "torch==2.11.0+cu128" "torchvision==0.26.0+cu128" --index-url "https://download.pytorch.org/whl/cu128"
    if ($LASTEXITCODE -ne 0) { throw "PyTorch CUDA 运行环境安装失败" }
}
finally {
    Remove-Item $installMarker -Force -ErrorAction SilentlyContinue
}

& (Join-Path $serviceDir "start-hidden.ps1")
