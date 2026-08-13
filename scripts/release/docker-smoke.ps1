param(
  [int]$Port = 4176,
  [int]$NonIsolatedPort = 4177,
  [string]$Image = 'mx-player-max-demo:phase-12-local',
  [string]$ContainerName = 'mx-player-max-phase12-smoke'
)

$ErrorActionPreference = 'Stop'
$smokeLabel = 'com.mx-player-max.smoke=phase12'
$baseUrl = "http://127.0.0.1:$Port"
$nonIsolatedBaseUrl = "http://127.0.0.1:$NonIsolatedPort"
$containerId = $null

function Invoke-Docker {
  param([string[]]$Arguments)
  $output = & docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "docker $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
  return (($output | Out-String).Trim())
}

function Get-HeaderValue {
  param($Response, [string]$Name)
  $value = $Response.Headers[$Name]
  if ($null -eq $value) { throw "Missing $Name on $($Response.BaseResponse.RequestMessage.RequestUri)" }
  return (($value -join ', ').Trim())
}

function Assert-Equal {
  param([string]$Actual, [string]$Expected, [string]$Description)
  if ($Actual -ne $Expected) { throw "$Description expected '$Expected', received '$Actual'" }
}

function Assert-Match {
  param([string]$Actual, [string]$Pattern, [string]$Description)
  if ($Actual -notmatch $Pattern) { throw "$Description did not match '$Pattern': '$Actual'" }
}

if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the Phase 12 demo smoke.'
}

try {
  $existing = Invoke-Docker @('ps', '-a', '--filter', "name=^/$ContainerName$", '--format', '{{.ID}}')
  if ($existing) { throw "Container name '$ContainerName' is already in use; it was not modified." }

  $containerId = Invoke-Docker @(
    'run', '--detach', '--name', $ContainerName,
    '--label', $smokeLabel,
    '--publish', "127.0.0.1:${Port}:80",
    '--publish', "127.0.0.1:${NonIsolatedPort}:8080",
    $Image
  )

  $htmlResponse = $null
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $candidate = Invoke-WebRequest -Uri "$baseUrl/index.html" -TimeoutSec 2
      if ($candidate.StatusCode -eq 200) { $htmlResponse = $candidate; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if ($null -eq $htmlResponse) { throw "Demo did not become ready at $baseUrl" }

  Assert-Equal (Get-HeaderValue $htmlResponse 'Cross-Origin-Opener-Policy') 'same-origin' 'HTML COOP'
  Assert-Equal (Get-HeaderValue $htmlResponse 'Cross-Origin-Embedder-Policy') 'require-corp' 'HTML COEP'
  Assert-Equal (Get-HeaderValue $htmlResponse 'X-Content-Type-Options') 'nosniff' 'HTML nosniff'
  Assert-Match (Get-HeaderValue $htmlResponse 'Content-Security-Policy') "object-src 'none'.*base-uri 'none'.*frame-ancestors 'none'" 'HTML CSP'
  $htmlCache = Get-HeaderValue $htmlResponse 'Cache-Control'
  Assert-Match $htmlCache '^no-cache$' 'HTML cache policy'
  if ($htmlCache -match 'immutable') { throw 'HTML navigation must not use immutable caching.' }

  $assetMatches = [regex]::Matches($htmlResponse.Content, '(?:src|href)="([^"]+\.(?:js|css))"')
  if ($assetMatches.Count -lt 2) { throw 'Could not discover versioned JavaScript and CSS assets.' }
  foreach ($match in $assetMatches) {
    $assetPath = $match.Groups[1].Value
    $assetResponse = Invoke-WebRequest -Uri ([Uri]::new([Uri]$baseUrl, $assetPath).AbsoluteUri)
    $contentType = Get-HeaderValue $assetResponse 'Content-Type'
    # Nginx may emit application/javascript or text/javascript depending on its mime.types package.
    if ($assetPath.EndsWith('.js')) { Assert-Match $contentType '^(?:application/javascript|text/javascript)' 'JavaScript MIME' }
    if ($assetPath.EndsWith('.css')) { Assert-Match $contentType '^text/css' 'CSS MIME' }
    Assert-Match (Get-HeaderValue $assetResponse 'Cache-Control') 'max-age=31536000.*immutable' 'Versioned asset cache policy'
    Assert-Equal (Get-HeaderValue $assetResponse 'X-Content-Type-Options') 'nosniff' 'Versioned asset nosniff'
  }

  $mimeTypes = Invoke-Docker @('exec', $containerId, 'sh', '-c', "grep -E 'application/wasm' /etc/nginx/mime.types")
  Assert-Match $mimeTypes 'application/wasm' 'WASM application/wasm MIME mapping'

  $rangeResponse = Invoke-WebRequest -Uri "$baseUrl/flower.webm" -Headers @{ Range = 'bytes=0-0' }
  if ($rangeResponse.StatusCode -ne 206) { throw "Range request expected 206, received $($rangeResponse.StatusCode)" }
  Assert-Equal (Get-HeaderValue $rangeResponse 'Accept-Ranges') 'bytes' 'Media Accept-Ranges'
  Assert-Equal (Get-HeaderValue $rangeResponse 'Content-Range') 'bytes 0-0/554058' 'Media Content-Range'
  Assert-Equal (Get-HeaderValue $rangeResponse 'Content-Length') '1' 'Media Content-Length'

  $missingResponse = Invoke-WebRequest -Uri "$baseUrl/assets/missing-deadbeef.js" -SkipHttpErrorCheck
  if ($missingResponse.StatusCode -ne 404) { throw "Missing asset expected 404, received $($missingResponse.StatusCode)" }

  $browserCheck = @'
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[1], { waitUntil: 'domcontentloaded' });
    if (await page.evaluate(() => globalThis.crossOriginIsolated) !== true) throw new Error('crossOriginIsolated was not true');
    await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
    if (await page.evaluate(() => globalThis.crossOriginIsolated) !== false) throw new Error('non-isolated endpoint was isolated');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
'@
  & pnpm exec node -e $browserCheck $baseUrl $nonIsolatedBaseUrl
  if ($LASTEXITCODE -ne 0) { throw 'Playwright crossOriginIsolated check failed.' }

  Write-Output "Docker smoke passed: CSP, headers, MIME, Range, 404, isolated $baseUrl, and non-isolated $nonIsolatedBaseUrl"
} finally {
  if ($containerId) {
    try {
      $currentId = Invoke-Docker @('inspect', '--format', '{{.Id}}', $ContainerName)
      $currentLabel = Invoke-Docker @('inspect', '--format', '{{index .Config.Labels "com.mx-player-max.smoke"}}', $ContainerName)
      if ($currentId -eq $containerId -and $currentLabel -eq 'phase12') {
        [void](Invoke-Docker @('rm', '--force', $containerId))
      } else {
        Write-Warning "Smoke container identity changed; '$ContainerName' was not removed."
      }
    } catch {
      Write-Warning "Could not verify and remove smoke container '$ContainerName': $($_.Exception.Message)"
    }
  }
}
