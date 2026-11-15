# Run GeoSound on a new machine

For a teammate who pulls the repo and wants the whole stack running with Docker. All services share the
team's Supabase project, so the database schemas already exist: you do not push any schema.

## 1. Install

- Docker Desktop (Windows or macOS) or Docker Engine + Compose v2 (Linux). Give Docker at least 6 GB of RAM:
  the AI image is large and loads an embedding model.
- Git and the GitHub CLI (`gh`) if you also open PRs.

## 2. Get the code and the `.env`

```bash
git clone https://github.com/Tran-Gia-Phuc/GeoSound.git
cd GeoSound
git switch develop
```

The root `.env` holds secrets (Supabase URLs, JWT secrets, Gemini key, SMTP password). It is never committed.
Ask the project owner for a copy through a private channel, put it at the repo root, and never paste it in a
chat, an issue or a PR. `.env.example` lists every key with comments; keys that are missing from your `.env`
fall back to the defaults in the code.

Change only these keys for your own machine:

| Key | Why |
| --- | --- |
| `SECURITY_ALERT_TO` | Demo inbox for "new device sign-in" emails. Put your own email, or leave it empty to send to the account email |
| `SMTP_*` | Optional: your own Gmail with an app password if you do not want mails to leave from the owner's account |
| `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` | Only for the phone demo, with your own free ngrok account ([phone-demo.md](phone-demo.md)) |

Do not change `DATABASE_URL_*`, `DATABASE_URL_DIRECT_*`, `JWT_*`, `INTERNAL_SERVICE_TOKEN` or `SUPABASE_*`:
they must be the same for the whole team. The `.env` must not contain a key twice.

## 3. Start

```bash
docker compose up -d --build        # first build takes several minutes (AI image)
docker compose ps                   # every service "Up", postgres / rabbitmq / redis "healthy"
```

Open <http://localhost:5173>. The API gateway is <http://localhost:8080>.

- Client changes are live without a rebuild (the source is mounted).
- After a `git pull` that changes a service, rebuild it: `docker compose up -d --build --no-deps <service>`.
- Logs: `docker compose logs --tail 30 <service>`.

## 4. Accounts

- Register in the app (email OTP). Authors pick "Tạo tour audio" at sign-up to get a contributor account.
- Admin accounts are not self-service. The project owner promotes an account in the Supabase SQL editor
  (`update app_auth.users set role = 'admin' where email = '...'`); the user signs out and in again.

## 5. Things that are shared

Everyone points to the same Supabase project:

- Accounts, tours, ratings, reports and notifications are shared: what you create, others see.
- Each machine has its own RabbitMQ: a tour submitted on machine A is moderated only on machine A.
- The Gemini free tier allows 5 requests per minute for the whole key: several machines moderating at once
  get 429 errors. For a demo, run the stack on one machine and let the others open it through the ngrok link.
- When the owner changes the Supabase password, every teammate must update the `DATABASE_URL_*` keys.

## 6. Problems

| Symptom | Fix |
| --- | --- |
| `docker compose up` stops on a missing key | Your `.env` is incomplete: compare key names with `cut -d= -f1 .env` and `.env.example` (names only, never print values) |
| Sign-in fails, Auth logs "Can't reach database server" | The `DATABASE_URL_AUTH` value is wrong or the Supabase password changed |
| `/api/chat` answers 404 | `CHATBOT_ENABLED` and `CHATBOT_INDEXER_ENABLED` must be `true`, then rebuild `ai` and `gateway` |
| Tours stay in "Chờ AI" | `MODERATION_EVENTS_ENABLED=true`, the `moderation` and `ai` containers up, and the Gemini key valid |
| No emails | `SMTP_HOST` is still the placeholder `smtp.example.com`; set a real SMTP server |
| Phone shows `403 Blocked request` | Start the stack with the ngrok script or `COMPOSE_FILE` lines ([phone-demo.md](phone-demo.md)) |
