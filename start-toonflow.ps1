param(
    [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"

$toonflowDir = Join-Path $PSScriptRoot "Toonflow-app-master"
$packageFile = Join-Path $toonflowDir "package.json"
$preferredNodeDir = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Directory -Filter "node-v24*-win-x64" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName

function Get-ToonflowWindowProcess {
    $escapedRoot = [Regex]::Escape($toonflowDir)
    $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq "electron.exe" -and $_.CommandLine -match $escapedRoot -and $_.CommandLine -notmatch "--type="
    }
    foreach ($candidate in $candidates) {
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($process) { return $process }
    }
    return $null
}

function Show-ToonflowWindow($process) {
    if (-not ("ToonflowWindow" -as [type])) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ToonflowWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    }
    [ToonflowWindow]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null
    [ToonflowWindow]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
}

if (-not (Test-Path $packageFile)) {
    throw "ToonFlow project not found: $toonflowDir"
}

$running = Get-ToonflowWindowProcess
if ($running) {
    if (-not $PrepareOnly -and $running.MainWindowHandle -ne 0) { Show-ToonflowWindow $running }
    Write-Host "ToonFlow is already running."
    exit 0
}

$nodeDir = $preferredNodeDir
if (-not $nodeDir -or -not (Test-Path (Join-Path $nodeDir "node.exe"))) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw "Node.js 24 is required to start ToonFlow." }
    $major = [int](& $nodeCommand.Source -p "process.versions.node.split('.')[0]")
    if ($major -lt 24) { throw "Node.js 24 is required to start ToonFlow. Current major version: $major" }
    $nodeDir = Split-Path $nodeCommand.Source
}

$env:Path = "$nodeDir;$env:Path"
$yarn = Join-Path $nodeDir "yarn.cmd"
if (-not (Test-Path $yarn)) {
    $corepack = Join-Path $nodeDir "corepack.cmd"
    if (-not (Test-Path $corepack)) { throw "Corepack is missing from Node.js 24." }
    & $corepack enable
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $yarn)) { throw "Unable to enable Yarn with Corepack." }
}

if (-not (Test-Path (Join-Path $toonflowDir "node_modules"))) {
    Write-Host "Installing ToonFlow dependencies..."
    Push-Location $toonflowDir
    try {
        & $yarn install
        if ($LASTEXITCODE -ne 0) { throw "ToonFlow dependency installation failed." }
    } finally {
        Pop-Location
    }
}

$sourceData = Join-Path $toonflowDir "data"
$runtimeData = Join-Path $env:APPDATA "Electron\data"
New-Item -ItemType Directory -Force -Path $runtimeData | Out-Null
Get-ChildItem -LiteralPath $sourceData -Recurse -Force | ForEach-Object {
    $relativePath = $_.FullName.Substring($sourceData.Length).TrimStart("\")
    $destination = Join-Path $runtimeData $relativePath
    if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
    } elseif (-not (Test-Path $destination)) {
        Copy-Item -LiteralPath $_.FullName -Destination $destination
    }
}

$electron = Join-Path $toonflowDir "node_modules\.bin\electron.cmd"
if (-not (Test-Path $electron)) { throw "ToonFlow Electron dependency is missing." }
$previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
$env:ELECTRON_RUN_AS_NODE = "1"
& $electron -e "require('better-sqlite3')" 2>$null
$nativeModuleReady = $LASTEXITCODE -eq 0
if ($null -eq $previousElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE } else { $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode }

if (-not $nativeModuleReady) {
    Write-Host "Rebuilding ToonFlow native modules for Electron..."
    Push-Location $toonflowDir
    try {
        & $yarn electron-rebuild -f -w better-sqlite3
        if ($LASTEXITCODE -ne 0) { throw "ToonFlow Electron native module rebuild failed." }
    } finally {
        Pop-Location
    }
}

if ($PrepareOnly) {
    Write-Host "ToonFlow is ready."
    exit 0
}

$logDir = Join-Path $env:LOCALAPPDATA "ToonFlow\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Process -FilePath $yarn -ArgumentList "dev:gui" -WorkingDirectory $toonflowDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "toonflow.log") -RedirectStandardError (Join-Path $logDir "toonflow-error.log")
Write-Host "ToonFlow is starting."
