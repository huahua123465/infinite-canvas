param(
    [switch]$StartOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$voiceboxDir = Join-Path $PSScriptRoot "voicebox"
$backendDir = Join-Path $voiceboxDir "backend"
$venvDir = Join-Path $backendDir "venv"
$python = Join-Path $venvDir "Scripts\python.exe"
$pip = Join-Path $venvDir "Scripts\pip.exe"
$runtimeDir = Join-Path $voiceboxDir ".runtime"
$modelsDir = Join-Path $runtimeDir "models"
$setupMarker = Join-Path $runtimeDir "setup-complete"
$webDistDir = Join-Path $voiceboxDir "web\dist"
$webIndex = Join-Path $webDistDir "index.html"
$frontendDir = Join-Path $voiceboxDir "frontend"
$frontendIndex = Join-Path $frontendDir "index.html"
$patchDir = Join-Path $PSScriptRoot "voicebox-patches"
$patchStateFile = Join-Path $runtimeDir "web-patch-state"
$git = (Get-Command git -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $voiceboxDir "package.json"))) {
    if (Test-Path $voiceboxDir) {
        throw "The voicebox directory is incomplete. Remove it and run start-web.bat again."
    }
    Write-Host "Downloading Voicebox v0.5.0 for first-time setup..."
    & $git clone --branch v0.5.0 --depth 1 --single-branch https://github.com/jamiepine/voicebox.git $voiceboxDir
    if ($LASTEXITCODE -ne 0) { throw "Voicebox source download failed." }
}

New-Item -ItemType Directory -Force -Path $runtimeDir, $modelsDir | Out-Null
$env:VOICEBOX_MODELS_DIR = $modelsDir
$env:HF_HOME = $modelsDir
$env:HF_HUB_CACHE = $modelsDir
$env:HUGGINGFACE_HUB_CACHE = $modelsDir
$env:HF_ASSETS_CACHE = Join-Path $modelsDir "assets"
$env:HF_XET_CACHE = Join-Path $modelsDir "xet"
$env:TORCH_HOME = Join-Path $modelsDir "torch"
$env:XDG_CACHE_HOME = Join-Path $modelsDir "cache"

$patchFiles = @(Get-ChildItem -Path $patchDir -Filter "*.patch" -File -ErrorAction SilentlyContinue | Sort-Object Name)
$patchState = ($patchFiles | ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join "`n"
$currentPatchState = if (Test-Path $patchStateFile) { [IO.File]::ReadAllText($patchStateFile) } else { "" }
$patchesChanged = $patchState -ne $currentPatchState
if ($patchesChanged) {
    Write-Host "Applying Infinite Canvas Voicebox Web patches..."
    foreach ($patchFile in $patchFiles) {
        & $git -C $voiceboxDir apply --reverse --check $patchFile.FullName 2>$null
        if ($LASTEXITCODE -eq 0) { continue }
        & $git -C $voiceboxDir apply --check $patchFile.FullName
        if ($LASTEXITCODE -ne 0) { throw "Voicebox Web patch cannot be applied: $($patchFile.Name)" }
        & $git -C $voiceboxDir apply $patchFile.FullName
        if ($LASTEXITCODE -ne 0) { throw "Voicebox Web patch failed: $($patchFile.Name)" }
    }
}
$needsWebBuild = $patchesChanged -or -not (Test-Path $webIndex)

if (-not $StartOnly) {
    if (-not (Test-Path $python)) {
        $systemPython = (Get-Command python -ErrorAction Stop).Source
        Write-Host "Creating Voicebox Python environment..."
        & $systemPython -m venv $venvDir
        if ($LASTEXITCODE -ne 0) { throw "Voicebox Python environment creation failed." }
    }
    if (-not (Test-Path $setupMarker)) {
        Write-Host "Installing Voicebox Python dependencies. The first run can take a while..."
        & $python -m pip install --upgrade pip -q
        if ($LASTEXITCODE -ne 0) { throw "Voicebox pip upgrade failed." }
        $hasNvidia = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" }).Count -gt 0
        if ($hasNvidia) {
            & $pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
            if ($LASTEXITCODE -ne 0) { throw "Voicebox CUDA PyTorch installation failed." }
        }
        $requirements = Join-Path $backendDir "requirements.txt"
        if ($env:OS -eq "Windows_NT") {
            $windowsRequirements = Join-Path $runtimeDir "requirements-windows.txt"
            $requirementsText = [IO.File]::ReadAllText($requirements).Replace("misaki[en,ja,zh]", "misaki[en,zh]")
            [IO.File]::WriteAllText($windowsRequirements, $requirementsText, [Text.UTF8Encoding]::new($false))
            Write-Host "Installing the prebuilt Windows OpenJTalk package..."
            & $pip install pyopenjtalk-plus==0.4.1.post8 fugashi jaconv mojimoji
            if ($LASTEXITCODE -ne 0) { throw "Voicebox Windows OpenJTalk dependency installation failed." }
            $requirements = $windowsRequirements
        }
        & $pip install -r $requirements
        if ($LASTEXITCODE -ne 0) { throw "Voicebox Python dependency installation failed." }
        & $pip install --no-deps chatterbox-tts hume-tada
        if ($LASTEXITCODE -ne 0) { throw "Voicebox optional TTS engine installation failed." }
        & $pip install git+https://github.com/QwenLM/Qwen3-TTS.git
        if ($LASTEXITCODE -ne 0) { throw "Voicebox Qwen3-TTS installation failed." }
        New-Item -ItemType File -Force -Path $setupMarker | Out-Null
    }
    if ($needsWebBuild) {
        Write-Host "Installing and preparing the Voicebox Web page..."
        Push-Location $voiceboxDir
        try {
            & cmd /c "npx -y bun@1.3.8 install"
            if ($LASTEXITCODE -ne 0) { throw "Voicebox JavaScript dependency installation failed." }
            & cmd /c "npx -y bun@1.3.8 run build:web"
            if ($LASTEXITCODE -ne 0) { throw "Voicebox Web build failed." }
        } finally {
            Pop-Location
        }
        Write-Host "Preparing Voicebox Web files for the local service..."
        New-Item -ItemType Directory -Force -Path $frontendDir | Out-Null
        Copy-Item -Path (Join-Path $webDistDir "*") -Destination $frontendDir -Recurse -Force
        [IO.File]::WriteAllText($patchStateFile, $patchState, [Text.UTF8Encoding]::new($false))
    } elseif (-not (Test-Path $frontendIndex)) {
        Write-Host "Preparing Voicebox Web files for the local service..."
        New-Item -ItemType Directory -Force -Path $frontendDir | Out-Null
        Copy-Item -Path (Join-Path $webDistDir "*") -Destination $frontendDir -Recurse -Force
    }
} elseif (-not (Test-Path $python) -or -not (Test-Path $frontendIndex)) {
    throw "Voicebox is not prepared. Run start-web.bat without -StartOnly first."
}

try {
    Invoke-WebRequest -Uri "http://127.0.0.1:17493/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
    Write-Host "Starting Voicebox local service..."
    $stdout = Join-Path $runtimeDir "voicebox.log"
    $stderr = Join-Path $runtimeDir "voicebox-error.log"
    Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "17493" -WorkingDirectory $voiceboxDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:17493/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) {
        throw "Voicebox did not become ready. Check $stderr"
    }
}

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:17493"
}
