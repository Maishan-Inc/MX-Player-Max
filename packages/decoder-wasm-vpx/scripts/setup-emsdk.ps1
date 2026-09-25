[CmdletBinding()]
param(
  [string]$EmsdkRoot = 'G:\Node\emsdk',
  [string]$RequiredVersion = '4.0.15'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EmsdkRoot -PathType Container)) {
  throw "Emscripten SDK directory was not found: $EmsdkRoot"
}

$emscriptenDir = Join-Path $EmsdkRoot 'upstream\emscripten'
$binDir = Join-Path $EmsdkRoot 'upstream\bin'
$emcc = Join-Path $emscriptenDir 'emcc.bat'
$empp = Join-Path $emscriptenDir 'em++.bat'
$wasmLd = Join-Path $binDir 'wasm-ld.exe'
$python = Join-Path $EmsdkRoot 'python\3.13.3_64bit\python.exe'
$node = Join-Path $EmsdkRoot 'node\24.19.0_64bit\node.exe'

foreach ($requiredPath in @($emcc, $empp, $wasmLd)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Emscripten tool is missing: $requiredPath. Run emsdk.bat install $RequiredVersion first."
  }
}

$env:EMSDK = $EmsdkRoot
if (Test-Path -LiteralPath $python -PathType Leaf) { $env:EMSDK_PYTHON = $python }
if (Test-Path -LiteralPath $node -PathType Leaf) { $env:EMSDK_NODE = $node }

$pathEntries = $env:Path -split [IO.Path]::PathSeparator
$env:Path = (@($EmsdkRoot, $emscriptenDir, $binDir) + $pathEntries |
  Select-Object -Unique) -join [IO.Path]::PathSeparator

$versionOutput = (& $emcc '--version' | Out-String).Trim()
if ($versionOutput -notmatch [regex]::Escape($RequiredVersion)) {
  throw "Emscripten version mismatch. Expected $RequiredVersion, got: $versionOutput"
}

Write-Host "Emscripten $RequiredVersion is ready."
Write-Host "  emcc:    $emcc"
Write-Host "  wasm-ld: $wasmLd"
Write-Host 'This script changes the current PowerShell process. Run it with dot-sourcing:'
Write-Host ". .\scripts\setup-emsdk.ps1"
