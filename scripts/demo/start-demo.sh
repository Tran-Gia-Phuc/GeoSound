#!/usr/bin/env bash
# Starts GeoSound with an ngrok tunnel and prints the phone URL (docs/04-guides/phone-demo.md).
# Usage: scripts/demo/start-demo.sh [--build | --stop]   (macOS, Linux, Git Bash)
set -euo pipefail

cd "$(dirname "$0")/../.."
override=scripts/demo/docker-compose.ngrok.yml

if [ "${1:-}" = "--stop" ]; then
  docker compose -f docker-compose.yml -f "$override" stop ngrok
  echo 'Tunnel stopped. The app still runs on this PC (http://localhost:5173).'
  exit 0
fi

build=()
[ "${1:-}" = "--build" ] && build=(--build)
docker compose -f docker-compose.yml -f "$override" up -d "${build[@]}"

# Wait for the tunnel and read its public URL from the local ngrok inspector.
url=''
for _ in $(seq 1 30); do
  sleep 2
  url=$(curl -s --max-time 2 http://127.0.0.1:4040/api/tunnels \
    | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4) || true
  [ -n "$url" ] && break
done

if [ -n "$url" ]; then
  echo
  echo "Phone URL: $url"
  echo 'Open it on the phone (any Wi-Fi or 4G). First visit: tap "Visit Site" on the ngrok page.'
  echo 'Close the tunnel after the demo:  scripts/demo/start-demo.sh --stop'
else
  echo 'Tunnel not up. Check: docker compose logs --tail 30 ngrok'
fi
