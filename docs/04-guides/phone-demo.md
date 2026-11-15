# Phone demo through ngrok

Run GeoSound on your PC with Docker and open it on any phone (other Wi-Fi or 4G) through a fixed
https address. The tunnel is optional: without it the stack runs as before on `http://localhost:5173`.

## One-time setup

1. Create a free account at <https://dashboard.ngrok.com/signup> (one per person).
2. In the dashboard copy:
   - **Your Authtoken** (secret: never commit it or paste it in chat);
   - **Domains**: the free static domain, for example `my-name.ngrok-free.dev`.
3. Add both to the root `.env` (not `.env.example`, which is committed):

   ```env
   NGROK_AUTHTOKEN=<your authtoken>
   NGROK_DOMAIN=<your domain, without https://>
   ```

## Every demo

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\demo\start-demo.ps1          # add -Build after a pull
```

```bash
# macOS, Linux, Git Bash
scripts/demo/start-demo.sh                                                    # add --build after a pull
```

The script starts the whole stack plus an `ngrok` container and prints `Phone URL: https://...`.
Open it on the phone; the first visit shows an ngrok warning page: tap **Visit Site**.

After the demo close the tunnel (anyone with the link can reach the app while it is open):
`start-demo.ps1 -Stop` or `start-demo.sh --stop`. The app keeps running on the PC.

## Start ngrok automatically

To skip the script, add these two lines to the root `.env` (they are commented out in `.env.example`):

```env
COMPOSE_PATH_SEPARATOR=,
COMPOSE_FILE=docker-compose.yml,scripts/demo/docker-compose.ngrok.yml
```

Docker Compose reads them from `.env`, so a plain `docker compose up -d --build` also starts ngrok, and
`docker compose ps` / `logs` / `down` include it. With Docker Desktop set to start at sign-in, the
containers (ngrok too, `restart: unless-stopped`) come back by themselves after a reboot; the phone
URL never changes. To pause the tunnel: `docker compose stop ngrok`. Keep the two lines out of `.env`
when `NGROK_AUTHTOKEN` / `NGROK_DOMAIN` are empty: compose then stops with "set NGROK_DOMAIN in .env".

## How it works

- `scripts/demo/docker-compose.ngrok.yml` is layered on `docker-compose.yml`. It adds the `ngrok`
  service (`ngrok http client:5173 --url=$NGROK_DOMAIN`) and sets `VITE_ALLOWED_HOSTS` on the client.
- `client/vite.config.js` reads `VITE_ALLOWED_HOSTS` (comma separated) into `server.allowedHosts`.
  Vite blocks unknown host names, so without it the tunnel answers **403 Blocked request**.
- The client calls the API on the same origin (`/api`, Vite proxy to the gateway), so nothing else changes.
- The ngrok inspector is published on `127.0.0.1:4040` only.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `403 Blocked request` on the phone | The client was recreated by a plain `docker compose up` without `COMPOSE_FILE` in `.env`. Run the script again, or add the two lines above |
| `ERR_NGROK_...` page | The PC, Docker or the `ngrok` container is down: run the script; see `docker compose logs --tail 30 ngrok` |
| `set NGROK_DOMAIN in .env` | The two keys are missing from the root `.env` |

## Optional QR code on the sign-in page

On wide screens the sign-in page shows a QR code when `client/public/qr-mobile.png` exists, and hides
it otherwise. The file is ignored by git because it encodes your own domain. To make one: open your
ngrok URL in Chrome, Edge or Cốc Cốc on the PC, right click, "Create QR code for this page", download
it and save it as `client/public/qr-mobile.png`.
