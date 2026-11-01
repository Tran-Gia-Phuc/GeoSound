# Starts GeoSound with an ngrok tunnel and prints the phone URL (docs/04-guides/phone-demo.md).
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\demo\start-demo.ps1          start or update
#   powershell -ExecutionPolicy Bypass -File scripts\demo\start-demo.ps1 -Build   rebuild images first
#   powershell -ExecutionPolicy Bypass -File scripts\demo\start-demo.ps1 -Stop    close only the tunnel
param([switch]$Build, [switch]$Stop)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$override = Join-Path $PSScriptRoot 'docker-compose.ngrok.yml'
Set-Location $repo

if ($Stop) {
  docker compose -f docker-compose.yml -f $override stop ngrok
  Write-Host 'Tunnel stopped. The app still runs on this PC (http://localhost:5173).'
  exit 0
}

$upArgs = @('compose', '-f', 'docker-compose.yml', '-f', $override, 'up', '-d')
if ($Build) { $upArgs += '--build' }
& docker @upArgs
if ($LASTEXITCODE -ne 0) { Write-Host 'docker compose failed (check NGROK_AUTHTOKEN and NGROK_DOMAIN in .env).'; exit 1 }

# Wait for the tunnel and read its public URL from the local ngrok inspector.
$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  try {
    $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
    $url = ($tunnels.tunnels | Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1).public_url
  } catch { }
}

if ($url) {
  Write-Host ''
  Write-Host "Phone URL: $url" -ForegroundColor Green
  Write-Host 'Open it on the phone (any Wi-Fi or 4G). First visit: tap "Visit Site" on the ngrok page.'
  Write-Host 'Close the tunnel after the demo:  scripts\demo\start-demo.ps1 -Stop'
} else {
  Write-Host 'Tunnel not up. Check: docker compose logs --tail 30 ngrok'
}
