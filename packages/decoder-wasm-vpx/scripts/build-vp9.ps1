[CmdletBinding()]
param(
  [string]$EmsdkRoot = 'G:\Node\emsdk',
  [string]$SourceRoot = '',
  [string]$SourceUrl = 'https://github.com/webmproject/libvpx.git',
  [switch]$FetchSource,
  [switch]$SkipNativeBuild,
  [ValidateRange(1, 32)][int]$Jobs = 4,
  [ValidateSet('single', 'simd', 'threaded')][string[]]$Variants = @('single', 'simd', 'threaded')
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = if ($SourceRoot) { [IO.Path]::GetFullPath($SourceRoot) } else { Join-Path $packageRoot 'third_party\libvpx-upstream' }
$sourceCommit = 'd168454ecd099805c675d4a98c66f4891373302a'
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.git'))) {
  if (-not $FetchSource) { throw "Missing libvpx checkout: $sourceRoot. Use -FetchSource." }
  & git -c core.autocrlf=false clone --depth 1 --branch v1.15.2 $SourceUrl $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw 'libvpx clone failed.' }
}
$actualCommit = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $sourceCommit) { throw "Expected libvpx commit $sourceCommit; got $actualCommit" }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'configure'))) { throw 'Incomplete libvpx checkout.' }
$gitRoot = Split-Path (Split-Path (Get-Command git.exe -ErrorAction Stop).Source)
$bash = Join-Path $gitRoot 'bin\bash.exe'
if (-not (Test-Path -LiteralPath $bash)) { throw 'Git for Windows Bash is required.' }
$make = Get-Command gmake.exe, make.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $make) { throw 'GNU Make is required (for example Strawberry Perl gmake.exe).' }

# Isolate setup variables from the caller's build arguments.
& (Join-Path $PSScriptRoot 'setup-emsdk.ps1') -EmsdkRoot $EmsdkRoot
if ($SkipNativeBuild) { return }
$env:MXVPX_EMSDK = $EmsdkRoot
$env:MXVPX_SOURCE = $sourceRoot
$env:MXVPX_PACKAGE = $packageRoot
$env:MXVPX_MAKE = $make.Source
$env:MXVPX_JOBS = "$Jobs"
foreach ($variant in $Variants) {
  & $bash --noprofile --norc (Join-Path $PSScriptRoot 'build-vp9.sh') $variant
  if ($LASTEXITCODE -ne 0) { throw "VP9 $variant build failed with exit code $LASTEXITCODE" }
}
