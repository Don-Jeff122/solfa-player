[CmdletBinding()]
param(
  [string]$AudiverisBin = (Join-Path $env:LOCALAPPDATA 'Programs\Audiveris\Audiveris.exe'),
  [string]$Repo = 'Don-Jeff122/solfa-player',
  [switch]$SkipDeploy,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serviceDir = Join-Path $root 'omr-service'
$stateDir = Join-Path $env:LOCALAPPDATA 'Temp\solfa-omr-tunnel'
$backendPidFile = Join-Path $stateDir 'backend.pid'
$tunnelPidFile = Join-Path $stateDir 'tunnel.pid'
$urlFile = Join-Path $stateDir 'public-url.txt'
$localUrl = 'http://127.0.0.1:8788'

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

function Stop-SavedProcess([string]$pidFile) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return }
  $savedPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if ($Stop) {
  Stop-SavedProcess $tunnelPidFile
  Stop-SavedProcess $backendPidFile
  Write-Output 'Stopped the saved OMR backend and tunnel.'
  exit 0
}

if (-not (Test-Path -LiteralPath $AudiverisBin)) {
  throw "Audiveris was not found at $AudiverisBin"
}

$cloudflared = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "cloudflared was not found at $cloudflared"
}

Stop-SavedProcess $tunnelPidFile
Stop-SavedProcess $backendPidFile

$existing = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  throw 'Port 8788 is already in use. Stop the existing OMR backend before running this script.'
}

$env:AUDIVERIS_BIN = $AudiverisBin
$env:OMR_TEMP_DIR = Join-Path $stateDir 'work'
$env:OMR_MAX_CONCURRENT = '1'
$env:OMR_MAX_PENDING = '4'
$env:OMR_MAX_JOBS = '50'
$env:OMR_UPLOADS_PER_WINDOW = '10'
$env:OMR_UPLOAD_WINDOW_MS = '3600000'
New-Item -ItemType Directory -Path $env:OMR_TEMP_DIR -Force | Out-Null

$backendOut = Join-Path $stateDir 'backend.out.log'
$backendErr = Join-Path $stateDir 'backend.err.log'
$node = (Get-Command node -ErrorAction Stop).Source
$backend = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory $serviceDir -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $backendPidFile -Value $backend.Id -Encoding ascii

$health = $null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  if ($backend.HasExited) { break }
  try {
    $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $health) {
  $log = ''
  if (Test-Path -LiteralPath $backendErr) { $log = Get-Content -LiteralPath $backendErr -Raw }
  Stop-SavedProcess $backendPidFile
  throw "The OMR backend did not start. $log"
}
if (-not $health.audiveris.available) {
  Stop-SavedProcess $backendPidFile
  throw "Audiveris is not available at $($health.audiveris.bin)"
}

$tunnelOut = Join-Path $stateDir 'tunnel.out.log'
$tunnelErr = Join-Path $stateDir 'tunnel.err.log'
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', $localUrl, '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4', '--loglevel', 'info') -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $tunnelPidFile -Value $tunnel.Id -Encoding ascii

$publicUrl = $null
for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
  $lines = ''
  if (Test-Path -LiteralPath $tunnelOut) { $lines += Get-Content -LiteralPath $tunnelOut -Raw }
  if (Test-Path -LiteralPath $tunnelErr) { $lines += Get-Content -LiteralPath $tunnelErr -Raw }
  $match = [regex]::Match($lines, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $publicUrl = $match.Value
    break
  }
  if ($tunnel.HasExited) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $publicUrl) {
  $log = ''
  if (Test-Path -LiteralPath $tunnelErr) { $log = Get-Content -LiteralPath $tunnelErr -Raw }
  Stop-SavedProcess $tunnelPidFile
  Stop-SavedProcess $backendPidFile
  throw "The Cloudflare tunnel did not provide a URL. $log"
}

$publicHealth = $null
for ($attempt = 0; $attempt -lt 240; $attempt += 1) {
  try {
    $publicHealth = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 5
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $publicHealth) {
  Stop-SavedProcess $tunnelPidFile
  Stop-SavedProcess $backendPidFile
  throw "The public tunnel URL did not become healthy: $publicUrl"
}

Set-Content -LiteralPath $urlFile -Value $publicUrl -Encoding ascii

if (-not $SkipDeploy) {
  & gh variable set OMR_API_URL --repo $Repo --body $publicUrl
  if ($LASTEXITCODE -ne 0) { throw 'Could not set the OMR_API_URL repository variable.' }
  & gh workflow run 'Deploy to GitHub Pages' --repo $Repo --ref main
  if ($LASTEXITCODE -ne 0) { throw 'Could not dispatch the GitHub Pages deployment.' }
}

Write-Output "Local backend: $localUrl"
Write-Output "Public URL: $publicUrl"
Write-Output "Audiveris: $($publicHealth.audiveris.bin)"
Write-Output "Queue limits: pending=$($publicHealth.queue.maxPending) jobs=$($publicHealth.queue.maxJobs)"
if ($SkipDeploy) {
  Write-Output 'Skipped OMR_API_URL update and Pages deployment.'
} else {
  Write-Output 'Updated OMR_API_URL and dispatched the Pages deployment.'
}
