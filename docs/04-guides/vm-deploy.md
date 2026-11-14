# Production deploy on one VM

`docker-compose.prod.yml` runs the whole GeoSound stack on one Linux VM with the production images. It is the quick deploy of deployment plan task 0.10 (issue #361), used until the Kubernetes setup of phases 2 and 3 is ready (`docs/02-design/deployment-plan.md`).

## What runs

| Service | Image | Public |
| --- | --- | --- |
| `proxy` | `caddy:2.8-alpine`, config `infra/caddy/Caddyfile` | ports 80 and 443: `/api/*` goes to the gateway, everything else to the client |
| `client` | `<prefix>-client` (nginx serving the built PWA, task 0.1) | no |
| `gateway`, `auth`, `tour`, `moderation`, `media`, `notification` | `<prefix>-<service>` (prod target, non-root, task 0.2) | no |
| `ai` | `<prefix>-ai` (task 0.3, embedding model inside the image) | no |
| `rabbitmq`, `redis` | `rabbitmq:3-alpine`, `redis:7-alpine`, each with a data volume | no |
| `migrate` | the tour image, profile `migrate`, never started by `up` | no |

There is no Postgres container: every `DATABASE_URL_*` points to Supabase. Uploads go to Supabase Storage (`MEDIA_STORAGE=supabase` is set in the file, task 0.7).

Differences from the dev `docker-compose.yml`: no source mounts, no Vite dev server, no published ports except the proxy, `NODE_ENV=production` forced, healthchecks on `/readyz`, log rotation (3 × 10 MB per container), and `TRUST_PROXY=1` on the gateway so its per-IP rate limits see the client IP behind Caddy.

## Requirements

- Linux VM with Docker Engine and the Compose plugin. Memory: about 2.5 GB for the app (section 5 of the deployment plan), so 4 GB or more.
- Ports 80 and 443 open. For HTTPS, a domain (or a free subdomain) with an A record to the VM.
- A checkout of the repository: the compose file, the Caddyfile, `scripts/db/migrate.sh` and the `prisma` folders are read from it. No application code is mounted.

## First deploy

1. Clone the repository on the VM and check out the release (`main`).
2. Create `.env` next to `docker-compose.prod.yml` from `.env.example`, with production values. Never commit it. Check in particular:
   - `DATABASE_URL_<SVC>` for auth, tour, moderation, media, notification (and AI when the chatbot uses Postgres), plus `DATABASE_URL_DIRECT_<SVC>` (Supabase session pooler, port 5432) for the migrations. See `docs/04-guides/supabase-access.md`.
   - `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS` (required) and `RABBITMQ_URL=amqp://<user>:<pass>@rabbitmq:5672` with the same values.
   - `REDIS_URL=redis://redis:6379`.
   - New random values for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN`, `STATS_ACTOR_SALT`.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (media stops at start without them).
   - `SITE_ADDRESS=<your domain>` for HTTPS. Without it Caddy serves plain HTTP on port 80.
   - `IMAGE_TAG` (default `latest`) and, if the images are not in the team's GHCR, `IMAGE_PREFIX`.
   - `NODE_ENV` and `VITE_API_BASE_URL` from `.env` are not used: the file forces `production`, and the client calls the API on its own origin.
3. Get the images. Once phase 1 publishes them to GHCR:

   ```sh
   docker compose -f docker-compose.prod.yml pull
   ```

   Until then, build them on the VM (the same Dockerfiles; the AI image takes the longest):

   ```sh
   docker compose -f docker-compose.prod.yml build
   ```

4. Apply the schema migrations (task 0.6). No service changes its schema on start.

   ```sh
   docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate          # deploy
   docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate status   # check
   ```

   A Supabase schema made earlier with `prisma db push` must be baselined once first (`check`, then `baseline`), with the user's go-ahead: see `scripts/db/migrate.sh`.

5. Start the stack and check it:

   ```sh
   docker compose -f docker-compose.prod.yml up -d
   docker compose -f docker-compose.prod.yml ps        # every app service "healthy"
   curl -I https://<your domain>/                      # the PWA
   curl https://<your domain>/api/tours                # the API through the gateway
   ```

## Release and rollback

```sh
git pull                                              # compose file, Caddyfile, migrations
# set IMAGE_TAG in .env to the new tag (or rebuild)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d       # recreates only the changed services
```

Rollback: set the previous `IMAGE_TAG` and run `up -d` again. Migrations are forward only, so a release must not need a schema change that the previous images cannot work with (section 8.5 of the deployment plan).

## Operations

- Logs: `docker compose -f docker-compose.prod.yml logs --tail 50 <service>`. Request lines are JSON (task 0.9); one request has the same `reqId` in the gateway and the service lines.
- Restart one service: `docker compose -f docker-compose.prod.yml restart <service>` (graceful, at most 30 s, task 0.5).
- RabbitMQ and Redis publish no port. Use `docker compose -f docker-compose.prod.yml exec rabbitmq rabbitmqctl list_queues` or `exec redis redis-cli`.
- Data on the VM: only the `rabbitdata`, `redisdata` (queues in flight, sessions, rate limits, locks) and `caddydata` (certificates) volumes. Users, tours and files live in Supabase.
