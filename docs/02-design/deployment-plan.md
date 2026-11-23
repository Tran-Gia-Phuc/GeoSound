# Deployment plan: CI/CD, Kubernetes, Prometheus and Grafana

Status: **in progress** (proposal 2026-11-09). Phase 0 (tasks 0.1 to 0.10) is done (section 6.1). Phase 1 (tasks 1.1 to 1.3) is built (section 7.1); it is done when a merge to `staging` publishes the 8 images. Phase 2 (tasks 2.1 to 2.6) is built and checked on a local k3s (section 8.6); it is done when the chart runs on the real VM. Phase 3 is done (section 9.4): Argo CD runs on the laptop cluster (3.1), the CI job `promote` deploys every build of `staging` (3.2), a read-only PostSync Job checks every sync (3.3), the results go to Discord (3.4), and the production release flow is written down (3.5). Phase 4 is built and runs on the laptop cluster (section 10.6): Prometheus, Grafana, Alertmanager, Loki and Alloy through Argo CD (4.1), metrics in every service (4.2 to 4.4), scraping (4.5), five dashboards (4.6) and alerts to Discord (4.7). Later phases need the team's agreement, because they touch every service and the shared infrastructure.

## 1. Goal and scope

Today GeoSound has CI only (`.github/workflows/ci.yml`: syntax check, Prisma validate, unit tests, client build, Playwright smoke tests). It runs with `docker compose` on a laptop and is shown on a phone through ngrok. There is no deployment pipeline, no metrics and no alerting.

This plan describes how to run GeoSound like a production system:

- **CI** builds, scans and publishes one Docker image per service.
- **CD** deploys these images to Kubernetes with GitOps (Argo CD), first to staging, then to production after a human approval.
- **Kubernetes** (k3s) runs every service with health probes, rolling updates, autoscaling and HTTPS.
- **Observability**: Prometheus metrics, Grafana dashboards, Loki logs and Alertmanager alerts, including business metrics of the AI and Moderation services.

Out of scope: moving the database out of Supabase, multi-region, service mesh.

## 2. Current state (verified in the repo)

| Area | Today | Problem for production |
| --- | --- | --- |
| Client | `client/Dockerfile` runs `npm run dev` (Vite dev server, port 5173) | Dev server, no static build, source mounted as a volume |
| Images | Node images about 740 MB each, `ai` 1.5 GB, `npm install` with dev dependencies in most services | Slow pull and slow rollout |
| Schema | `auth` and `moderation` run `prisma db push` in the container `CMD` | Every new pod pushes the schema to Supabase; unsafe with several replicas |
| Health | `GET /health` returns `{status: 'ok'}` without checking anything | Not enough for readiness probes |
| Shutdown | No `SIGTERM` handler in any service | Rolling updates can cut requests and in-flight RabbitMQ messages |
| Logs | `shared/middleware` `logger` prints one plain text line per request | Hard to filter and correlate |
| Media | Files saved in the `mediadata` volume when Supabase Storage is not configured | A local volume ties the pod to one node |
| Background jobs | Moderation retry sweeper, hourly purges in `auth` and `tour`, Notification and Media workers | Run once per replica |
| Infra | RabbitMQ and Redis in compose, ports 5672, 15672 and 6379 published on the host | Must not be reachable from the internet |
| Secrets | One root `.env` read by every container | Needs to be split and stored outside git |

## 3. Target architecture

```text
Developer ── PR ──▶ GitHub Actions: CI (tests) ──▶ merge
                                   │
                                   ▼
                    images.yml: build 8 images, Trivy scan
                                   │ push
                                   ▼
                    GHCR  ghcr.io/<org>/geosound-<service>:sha-<7>
                                   │
                    bot commits the new tag to deploy/envs/<env>/values.yaml
                                   │
                                   ▼
                    Git repo (deploy/) ◀──── Argo CD watches and pulls
                                                     │ sync
 ┌───────────────────────── k3s cluster ─────────────▼──────────────────────┐
 │ Traefik Ingress + cert-manager (Let's Encrypt)                           │
 │   geosound.example.com      → client (nginx, static PWA)                 │
 │   geosound.example.com/api  → gateway                                    │
 │                                                                          │
 │ namespace geosound-staging and geosound-prod (same chart, other values)  │
 │   gateway  auth  tour  moderation  media  notification  ai               │
 │   rabbitmq (operator, PVC)   redis (StatefulSet, PVC)                    │
 │   migrate Jobs (prisma migrate deploy, Argo CD PreSync hook)             │
 │                                                                          │
 │ namespace monitoring                                                     │
 │   Prometheus  Alertmanager  Grafana  Loki  Alloy                         │
 │   node-exporter  kube-state-metrics  redis-exporter                      │
 │                                                                          │
 │ namespace argocd                                                         │
 └──────────────────────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
   Supabase Postgres + Storage        Alerts → Discord channel / email
   (outside the cluster)              LLM traces → LangSmith (already used)
```

Main choices and why:

| Choice | Reason | Rejected |
| --- | --- | --- |
| k3s on one VM | Real Kubernetes API, small footprint, Traefik and a storage class built in | Managed clusters cost more; Docker Swarm is not what the course expects |
| Helm chart | Seven Node services share the same shape; one template plus values per service | Plain YAML (much duplication); Kustomize alone (no loops over services) |
| Argo CD (pull) | Git is the single source of truth, visual sync status, one-click rollback, works with a cluster that has no public IP | `helm upgrade` from GitHub Actions needs a kubeconfig in CI secrets |
| GHCR | Free for the repo, same login as GitHub | Docker Hub rate limits |
| kube-prometheus-stack | One Helm release for Prometheus, Grafana, Alertmanager and the exporters | Installing each part by hand |
| Loki + Grafana Alloy | Logs in the same Grafana as the metrics; Alloy replaces Promtail, which is deprecated | ELK stack (too heavy for one VM) |

## 4. Environments and branches

The repo already uses `develop`, `staging` and `main`.

| Branch / tag | Environment | Deploy |
| --- | --- | --- |
| `feature/*`, PR | none | CI only |
| `develop` | none (optional `dev` namespace later) | CI and images |
| `staging` | `geosound-staging` | automatic: the bot commits the new tag, Argo CD auto-syncs |
| `main` + tag `vX.Y.Z` | `geosound-prod` | the bot opens a PR that changes the tag; a reviewer approves; Argo CD syncs |

Staging and production share the cluster (two namespaces) to stay within one VM. They use different Supabase schemas or projects and different secrets. Production never auto-syncs.

## 5. Infrastructure and budget

| Item | Size |
| --- | --- |
| VM | 4 vCPU, 8 GB RAM, 60 GB SSD, Ubuntu 24.04 LTS. Student credit (GitHub Student Pack, Azure for Students) or the school server. An ARM VM (for example Oracle Always Free) works too but needs `linux/arm64` images. |
| Domain | One domain or a free subdomain with an A record to the VM (needed for HTTPS) |
| Local alternative | k3d on a laptop with 16 GB RAM. Argo CD still works because it pulls from GitHub. |

Memory budget (requests, one replica each, one environment):

| Component | Request | Limit |
| --- | --- | --- |
| gateway, auth, tour, moderation, media, notification (6 × Node) | 6 × 192 Mi | 6 × 384 Mi |
| ai (FastAPI, LangGraph) | 512 Mi | 1 Gi |
| client (nginx) | 32 Mi | 64 Mi |
| rabbitmq | 512 Mi | 1 Gi |
| redis | 64 Mi | 256 Mi |
| app total | about 2.3 Gi | about 4.7 Gi |
| monitoring (Prometheus, Grafana, Loki, Alloy, exporters) | about 1.5 Gi | about 2.5 Gi |
| k3s, Traefik, Argo CD, cert-manager | about 1 Gi | |

Two environments plus monitoring fit in 8 GB only with staging scaled down (one replica, smaller limits). If memory is short, run staging with `ai` disabled or on demand.

## 6. Phase 0: make the services production-ready

This phase changes application code and is useful even if the team never adopts Kubernetes. Each row is one issue and one branch.

| # | Task | Files | Done when |
| --- | --- | --- | --- |
| 0.1 | Production client image: multi-stage build (`npm ci`, `vite build`) then `nginx:alpine` serving `dist/` with an SPA fallback (`try_files $uri /index.html`) and long cache headers for hashed assets. Keep the current Dockerfile as `Dockerfile.dev` for compose. | `client/Dockerfile`, `client/Dockerfile.dev`, `client/nginx.conf`, `docker-compose.yml` | Image under 60 MB; PWA and service worker load from nginx; compose still runs the dev server |
| 0.2 | Smaller Node images: multi-stage, `npm ci --omit=dev` in the final stage, `prisma generate` in the build stage, `USER node`, `NODE_ENV=production` | `services/*/Dockerfile`, `gateway/Dockerfile` | Each Node image under 300 MB, runs as non-root, tests still pass |
| 0.3 | Smaller AI image: multi-stage, `python:3.11-slim`, no build tools in the final stage, non-root user | `services/ai/Dockerfile` | Image clearly smaller than 1.5 GB, pytest passes |
| 0.4 | Health endpoints: `GET /healthz` (process alive, no I/O) and `GET /readyz` (DB `SELECT 1`, RabbitMQ channel open, Redis `PING` where used; 503 when not ready). Keep `/health` as an alias. | every `src/index.js`, `services/ai/app/main.py` | `/readyz` returns 503 when RabbitMQ is stopped and 200 again after it is back |
| 0.5 | Graceful shutdown: on `SIGTERM` stop accepting HTTP, cancel RabbitMQ consumers, wait for in-flight handlers (max 20 s), close Prisma and Redis, exit 0 | every `src/index.js`, a shared helper in `shared/` | `docker stop` during a moderation review does not lose the message (it is acked or requeued) |
| 0.6 | Schema migrations: create a Prisma migration baseline per service (`prisma migrate diff` from the current schema, marked as applied), switch to `prisma migrate deploy`, remove `db push` from the container `CMD` | `services/*/prisma/migrations/`, `services/auth/Dockerfile`, `services/moderation/Dockerfile` | A new pod never changes the schema; migrations run only in the migrate Job (phase 2) |
| 0.7 | Stateless media: production uses Supabase Storage (`SUPABASE_STORAGE_BUCKET`) or S3; the local `MEDIA_DIR` stays for dev only | `services/media` config, docs | Media pods can restart on any node without losing files |
| 0.8 | Singleton jobs: the Moderation retry sweeper and the hourly purges take a Redis lock (`SET key value NX PX ttl`) before each run, so several replicas do not run them twice | `services/moderation/src/interfaces/jobs/retry-sweeper.js`, `services/auth/src/index.js`, `services/tour/src/index.js` | With 2 replicas, one sweep per interval in the logs |
| 0.9 | Structured logs: JSON lines with `time`, `level`, `service`, `msg`, `reqId`, `method`, `path`, `status`, `durationMs`; the gateway creates `x-request-id` and forwards it | `shared/middleware/index.js`, `gateway/src` | Loki query `{service="tour"} \| json \| status >= 500` works |
| 0.10 | Production compose file without source mounts and without the local Postgres, for a quick VM deploy before k8s is ready | `docker-compose.prod.yml` | `docker compose -f docker-compose.prod.yml up -d` runs the stack from GHCR images |

### 6.1 Progress and deviations from the table

| # | Issue / PR | Result |
| --- | --- | --- |
| 0.1 | #337 / #338 | `client/Dockerfile` builds with `node:20-alpine` and serves `dist/` from `nginxinc/nginx-unprivileged:1.28-alpine-slim` (non-root, port 8080), about 22 MB. `client/nginx.conf`: `/healthz`, `/api/` returns 404 (the gateway serves the API), immutable cache for `/assets/` (not on 404s), no cache for `sw.js` and `registerSW.js`, `application/manifest+json` for the manifest, SPA fallback. Compose builds `client/Dockerfile.dev`. |
| 0.2 | #339 / #340 | Every Node Dockerfile has a `dev` target (nodemon, used by `docker-compose.dev.yml`) and a default `prod` target (`USER node`, `NODE_ENV=production`, `node src/index.js`). The Prisma CLI stays in the auth, tour, moderation and notification images: the team runs `npx prisma db push`, `validate` and `generate` in these containers, and the migrate Job of section 8.5 will too. `prisma generate` in a prod image needs `--user root` and network access. Sizes: 49 to 82 MB compressed, 148 to 225 MB uncompressed. The "740 MB" of section 2 is Docker Desktop's `image ls` number, which adds the compressed and uncompressed sizes. |
| 0.3 | #343 / #344 | `services/ai/Dockerfile`: build stage with a venv that has no pip of its own (`--without-pip`, packages installed with `pip --python`), `--no-compile`, `sympy` and `mpmath` removed (ONNX inference never imports them), package test suites removed; the runtime stage copies only the venv, `app/` and the model, and runs as user `app` (uid 10001) with `HF_HUB_OFFLINE=1`. The fp32 e5 model is kept on purpose: a quantized one would change the vectors and need a full re-index. Sizes: 449 to 407 MB compressed, root filesystem 1007 to 852 MB (387 MB without the model); embeddings identical. The AI pytest and eval commands need `--user root` (they `pip install` into the venv). |
| 0.4 | #345 | Shared module `shared/health`: `/healthz` and `/health` (liveness, no I/O) and `/readyz` (checks in parallel, 2 s timeout each, 503 only when a *required* check is down, no error text in the body). Required / reported only: gateway none / redis; auth db, redis / rabbitmq; tour db, rabbitmq when a broker flag is on / redis; moderation db, rabbitmq; media rabbitmq / redis; notification db, rabbitmq / redis; ai rabbitmq when `CHATBOT_INDEXER_ENABLED=true`. Fail-open Redis is only reported so a Redis outage does not take every pod out of the load balancer. The gateway image has no `shared/`, so its routes are inline. `shared/rabbitmq` now reconnects after a lost connection or channel (backoff 1 s to 30 s) and re-registers every consumer in order; `isReady()` is the check. Auth, tour and moderation wait for the broker at start instead of giving up after 15 attempts. Checked on the stack: with RabbitMQ stopped `/readyz` is 503 where required, and all seven queues have their consumer again about 40 s after it is back, without a container restart. |
| 0.5 | #348 | Shared module `shared/shutdown`: on `SIGTERM` or `SIGINT` the steps of each service run once, in order, each with its own limit, then the process exits 0; over 28 s in total it exits 1, and a second signal exits at once. From the first signal `/readyz` answers 503 `draining` (liveness stays 200). `SHUTDOWN_DELAY_MS` (default 0) waits before the first step so a load balancer sees the 503 before the HTTP server closes. Steps per service: stop intake in parallel (HTTP server closed, idle sockets at once, others after 10 s; `rabbit.stopConsuming()` cancels the consumers and waits up to 20 s for the handlers in flight, which can still publish because the channel stays open; in Moderation also the retry sweeper, whose `stop()` now waits for the running sweep), then RabbitMQ, Prisma and Redis close. After `stopConsuming()` the helper never connects, reconnects or consumes again. A Moderation review still running after 20 s is left: its message goes back to the queue on close, and the case left in `reviewing` is retried by the sweeper after `staleAfterMs`. The gateway (no `shared/`) has the same behaviour inline; the AI service uses `uvicorn --timeout-graceful-shutdown 20` and its lifespan closes the chatbot indexer. Compose sets `stop_grace_period: 30s` on the app services. Checked on the stack: `docker stop` exits 0 in 2 to 4 s for all seven (before: SIGKILL after 10 s, exit 137), every queue has its consumer again after the restart, and a check on the real broker with a temporary queue showed a handler that ends in time acked, a message sent after the cancel left in the queue, and a handler still running at the timeout requeued. |
| 0.6 | #352 | Baseline `prisma/migrations/0_init` (plus `migration_lock.toml`) for all six schemas, generated offline with `prisma migrate diff --from-empty`; the AI one also holds `pre-push.sql` (pgvector in `extensions`) and `post-push.sql` (CHECK constraints, partial and HNSW indexes). `auth` and `moderation` no longer run `db push` in their `CMD` (dev and prod). One-shot compose service `migrate` (profile `migrate`, tour image, every `prisma` folder mounted) runs `scripts/db/migrate.sh` with `deploy`, `status`, `check` (read-only drift check) and `baseline` (`migrate resolve --applied 0_init`), over `DATABASE_URL_DIRECT_<SVC>`. CI replays the migrations on a pgvector service container and fails when they do not build `schema.prisma` (`scripts/db/check-migrations.sh`). `.gitattributes` keeps `migration.sql` and `*.sh` in LF, because Prisma checksums each applied file. Checked on a disposable Postgres: `migrate deploy` from empty gives no diff for any schema, the AI constraints and indexes exist, and a schema made by `db push` baselines to "No pending migrations". Known exception: Prisma 5 cannot express the HNSW index, so a diff always proposes dropping it; both scripts ignore that line. Media and AI images have no Prisma CLI: their migrate Job will use a small migrate image (section 8.5). Supabase itself is baselined separately, after a read-only `check`, with the user's go-ahead. Team rule: no more `db push` (`docs/04-guides/supabase-access.md` section 4). |
| 0.7 | #353 | `MEDIA_STORAGE` (`supabase`, `local` or empty), read by `services/media/src/infrastructure/storage/select-storage.js`. `supabase` without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` stops the service at start, so a pod never writes uploads to its own disk; production sets `MEDIA_STORAGE=supabase` in the ConfigMap. Empty keeps the old automatic choice (Supabase when both keys are set, else `MEDIA_DIR`), so local compose is unchanged; the local disk with `NODE_ENV=production` logs a warning. No S3 adapter: Supabase Storage is the store of decision D3, and the `AWS_*` keys of section 8.4 stay unused until one is needed. Files already in a dev `mediadata` volume are not copied to Supabase. |
| 0.8 | #354 | Shared module `shared/lock`: `createJobLock(redis, { service }).runOnce(name, fn, { ttlMs, holdMs, onRedisError })`. `SET lock:job:<name> <token> NX PX ttlMs`; a replica that does not get the lock skips without a log line. While `fn` runs the lock is renewed every `ttlMs / 3`; when it ends the lock is kept until `holdMs` after the start, then expires (both owner only, Lua compare-and-set), so there is at most one run per `holdMs` whatever the phase of each replica's timer. Moderation retry sweeper: `ttlMs` 30 s, `holdMs` 80 % of `RETRY_SWEEP_INTERVAL_MS`, Redis down = the sweep of that tick is skipped (two sweeps could call the AI twice for the same case). Auth ended-session purge and Tour activity-mark purge: `ttlMs` 5 min, `holdMs` 48 min, Redis down = they run without the lock (idempotent deletes). Moderation now has a Redis client (`ioredis`, `REDIS_URL`): reported (not required) in `/readyz`, closed on shutdown, and compose starts it after Redis. Checked with 2 Moderation containers on one Redis and a 5 s interval: one sweep per interval in the logs. |
| 0.9 | #355 | Shared module `shared/middleware/request-log.js` (re-exported by `shared/middleware`): the existing `logger` middleware now writes one JSON line per finished request, `{time, level, service, msg: "request", reqId, method, path, status, durationMs}`, so no service `src/index.js` changed. `level` is `error` for 5xx, `warn` for 4xx, else `info`; `path` has no query string (it can carry tokens); a client that goes away before the answer is logged with status 499. `service` = `SERVICE_NAME`, else the `package.json` name of the working directory without `@geosound/`. Successful `/healthz`, `/readyz` and `/health` probes are not logged. A service reuses the incoming `x-request-id` when it matches `[A-Za-z0-9._-]{1,128}`, else creates a UUID, and echoes it in the response. The gateway (`gateway/src/request-log.js`, inline because its image has no `shared/`) always creates a new id, so a client cannot choose it, sets it on the request so `http-proxy-middleware` forwards it to every service and to the chat route, and logs the same line with `service: gateway`. `errorHandler` writes a JSON line too (`reqId`, `status`; stack only for 5xx). Not changed: startup, consumer and job logs stay plain text (Loki's `json` stage marks those lines with `__error__`), the AI service and RabbitMQ events do not carry the request id. Checked on the stack with a temporary gateway and media container: one request gave the same `reqId` in both logs. |
| 0.10 | #361 | `docker-compose.prod.yml` runs the whole stack on one VM with the production images (`${IMAGE_PREFIX}-<service>:${IMAGE_TAG}`, default `ghcr.io/tran-gia-phuc/geosound-*:latest`; each service keeps a `build` section, so the images can also be built on the VM until phase 1 publishes them). One public entry: Caddy (`caddy:2.8-alpine`, `infra/caddy/Caddyfile`) on ports 80 and 443, `/api/*` to the gateway and everything else to the client; a domain in `SITE_ADDRESS` gives automatic HTTPS, the default `:80` serves plain HTTP. The gateway, services, RabbitMQ and Redis publish no port. No Postgres container: every `DATABASE_URL_*` is required (`:?`) and points to Supabase; media forces `MEDIA_STORAGE=supabase` (0.7). Every app service forces `NODE_ENV=production` (the dev `.env` sets `development`), has a `/readyz` healthcheck (0.4), `stop_grace_period: 30s` (0.5) and log rotation (3 × 10 MB, json-file). RabbitMQ needs `RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS` and keeps a data volume; Redis runs with AOF. Migrations run with the one-shot `migrate` service (profile `migrate`, tour image, `scripts/db/migrate.sh`, 0.6) before `up`. Deviation: behind the proxy the gateway saw Caddy's IP as `req.ip`, so every client shared one rate-limit bucket; the gateway now reads `TRUST_PROXY` (`gateway/src/trust-proxy.js`, unset = old behaviour) and the prod file sets `1`. Guide: `docs/04-guides/vm-deploy.md`. Checked on a disposable compose project with a local pgvector Postgres in place of Supabase: migrate applied the 5 schemas, every service became healthy, the proxy served the PWA, SPA routes and `/api/tours`, the rate-limit key was the client IP, and the gateway and tour log lines shared one `reqId`. |

Rules that stay true: CI imports `shared` with the dynamic import pattern (`CLAUDE.md` section 7), `.env` is never committed, Auth and Moderation schema changes need the user's go-ahead.

## 7. Phase 1: CI builds and publishes images

Keep `ci.yml` as it is. Add `.github/workflows/images.yml`.

Triggers: push to `develop`, `staging`, `main`, and tags `v*`. It runs only after the CI jobs pass (same workflow with `needs:`, or `workflow_run` on `CI`).

Steps per service (matrix: `client, gateway, auth, tour, moderation, media, notification, ai`):

1. `dorny/paths-filter` to skip services with no changed files (always build all on tags).
2. `docker/setup-buildx-action`, `docker/login-action` to GHCR with `GITHUB_TOKEN` (`permissions: packages: write`).
3. `docker/build-push-action` with GitHub Actions cache (`cache-from: type=gha`), tags `sha-<7>` and, on tags, `vX.Y.Z`. Never push `latest` to production values.
4. `aquasecurity/trivy-action` on the pushed image: fail on `CRITICAL` with a fix available, report `HIGH`.
5. Upload the SBOM (`syft` or the BuildKit SBOM attestation) as an artifact.

Sketch:

```yaml
name: Images
on:
  push:
    branches: [develop, staging, main]
    tags: ['v*']
permissions:
  contents: read
  packages: write
jobs:
  build:
    strategy:
      matrix:
        service: [client, gateway, auth, tour, moderation, media, notification, ai]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: ${{ contains('client gateway', matrix.service) && matrix.service || '.' }}
          file: ${{ contains('client gateway', matrix.service) && format('{0}/Dockerfile', matrix.service) || format('services/{0}/Dockerfile', matrix.service) }}
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/geosound-${{ matrix.service }}:sha-${{ github.sha }}
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to: type=gha,mode=max,scope=${{ matrix.service }}
```

(The real file shortens the SHA, adds the paths filter, the Trivy step and the version tag.)

Done when: a merge to `staging` produces 8 images in GHCR in under 10 minutes with cache, and a known vulnerable base image fails the job.

### 7.1 Progress and deviations from the plan above

| # | Issue / PR | Result |
| --- | --- | --- |
| 1.1 | #363 | `.github/workflows/images.yml` is a reusable workflow (`workflow_call`): `ci.yml` calls it as the job `images` with `needs: [backend, client, browser]`, so an image only exists for a commit whose tests passed, in the same run (deviation: not `workflow_run`, whose separate run is not tied to the tests of the commit). Pull requests into `develop`, `staging` or `main` build the changed images and push nothing. Pushes to those branches publish `ghcr.io/<owner, lowercase>/geosound-<app>:sha-<7>` and `:<branch>`; a tag `vX.Y.Z` publishes `:vX.Y.Z` and `:sha-<7>`. `latest` is never pushed. Deviation: no `dorny/paths-filter`, which would leave the new tag missing for the apps that did not change. `scripts/ci/image-reuse.sh` reads the `org.opencontainers.image.revision` label of a candidate tag (the branch, then `develop`, `staging`, `main`; a release tries `sha-<7>` first) and, when none of the app's paths changed since that commit, CI retags that image in the registry (`docker buildx imagetools create`) instead of building it. So every tag exists for all 8 apps and one `IMAGE_TAG` deploys the whole stack. Any doubt (tag missing, no label, commit not in the history) means a build. Deviation: registry cache `:buildcache` (`mode=max`, written only by pushes) instead of `type=gha`, because the GitHub Actions cache holds 10 GB per repository and the AI layers are large. `provenance: false` keeps one plain manifest per tag. Checked: actionlint and shellcheck, and the reuse script against a local registry (same commit, own or other paths changed, missing tags, no label, unknown commit, candidate order). |
| 1.2 | #364 | Trivy 0.76.1 runs from its image pinned by digest, not through `trivy-action`: a digest cannot be moved to other code, an action tag can. Deviation: the scan runs on the built image before the push, not on the pushed one, so an image that fails never reaches GHCR. Gate: a `CRITICAL` finding with a fix fails the job (`--ignore-unfixed`); accepted findings go in `.trivyignore` (empty) with a reason. The `HIGH` and `CRITICAL` table is printed in the log, not blocking. SBOM: CycloneDX written by Trivy, kept as the artifact `sbom-<app>` for 30 days (deviation: no syft, no BuildKit attestation, which adds `unknown/unknown` entries in GHCR). A retagged image is not scanned again (same digest). Image changes the gate needed: the npm 10.8 bundled with Node 20 carried a `CRITICAL` in `tar` and most `HIGH` findings, so the `prod` stage of the 6 Node images installs npm 11.21.2 and runs `apk upgrade` (Node 20 is end of life since April 2026, its images are no longer rebuilt); npm stays because the team runs `npx prisma` in these containers. The client moved from `nginx-unprivileged:1.28-alpine-slim` (no update since February 2026, `CRITICAL` in openssl and nginx) to `1.30-alpine-slim`. Checked locally with the CI commands: the 8 images pass the gate (+3 MB per Node image), `node:14-alpine` fails it (2 `CRITICAL`). `HIGH` left: nodemailer 6 in auth and notification (the fix is a major version), Python packages of the AI image (starlette, langsmith, langgraph-sdk) and Debian packages, most without a fix. Follow-ups: Node 22 or 24 for every image, nodemailer upgrade. |
| 1.3 | #365 | `docker-compose.prod.yml`: `IMAGE_TAG` is required (`${IMAGE_TAG:?...}`, no `latest` default). `docs/04-guides/vm-deploy.md` and `.env.example` list the published tags (prefer `vX.Y.Z` or `sha-<7>`; a branch tag moves) and the GHCR access: public packages (set once per package by the repository owner), else `docker login ghcr.io` on the VM with a `read:packages` token. The Node services and AI build with the repo root as context, so `services/<svc>/.dockerignore` was never read (the root has no `.dockerignore`). It is replaced by `services/<svc>/Dockerfile.dockerignore`, which BuildKit reads next to the Dockerfile: an allow list of `services/<svc>/` and `shared/` (AI: `services/ai/`), without `node_modules`, `.env*`, tests and caches. Deviation from the issue: BuildKit already sends only the paths that `COPY` names, so the context was small before; the gain is what those paths no longer carry (`shared/test` was in every Node image, a host `shared/node_modules` would have replaced the Linux one, a `.env` or `__pycache__` under a service folder would have been copied). Checked: `docker compose -f docker-compose.prod.yml config -q` fails without `IMAGE_TAG` and passes with it; the 6 images build (`prod` and `dev` targets, and through the dev compose files). |

## 8. Phase 2: Kubernetes cluster and Helm chart

### 8.1 Cluster setup (one time, documented as a runbook)

The runbook is `docs/04-guides/k3s-cluster.md` (task 2.6).

1. Create the VM, open ports 22, 80 and 443 only. SSH with keys, no password login, `ufw` enabled.
2. Install k3s (`curl -sfL https://get.k3s.io | sh -`), keep Traefik and the local-path storage class.
3. Install cert-manager (Helm) and the `ClusterIssuer`s `letsencrypt-staging` and `letsencrypt-prod` (`deploy/cluster/cluster-issuers.yaml`; staging issuer first, then production).
4. Install Argo CD (Helm) in `argocd`; expose its UI through an Ingress with HTTPS, or use `kubectl port-forward` only. Moved to phase 3 (task 2.6): the runbook deploys with `helm upgrade --install` until then.
5. ~~Install the RabbitMQ Cluster Operator.~~ Not needed (task 2.3: StatefulSet). Install the Sealed Secrets controller instead (task 2.5).
6. Create namespaces `geosound-staging`, `geosound-prod`, `monitoring` (`deploy/cluster/namespaces.yaml`).
7. Create the secrets (section 8.4).
8. Make the GHCR packages public, or create an `imagePullSecret` with a read-only token.

### 8.2 Repository layout

```text
deploy/
  README.md                       how to deploy, roll back, add a service
  helm/geosound/
    Chart.yaml
    values.yaml                   defaults for every service
    templates/
      _helpers.tpl
      deployment.yaml             one Deployment per entry of .Values.services
      service.yaml
      configmap.yaml
      ingress.yaml                client and /api → gateway
      hpa.yaml
      pdb.yaml
      networkpolicy.yaml
      servicemonitor.yaml         Prometheus scrape config per service
      migrate-job.yaml            one Job, every schema (task 2.4), Argo CD PreSync hook
      rabbitmq.yaml               StatefulSet + Service + PVC (task 2.3: no operator)
      redis.yaml                  StatefulSet + Service + PVC
  envs/
    staging/values.yaml           image tags, host name, replicas, limits
    staging/sealed-secrets.pem    controller certificate, staging/sealed/*.yaml (task 2.5)
    prod/values.yaml
  cluster/                        namespaces.yaml, cluster-issuers.yaml (task 2.6, applied once)
  local/                          laptop stand-ins: Postgres, AI stub, values (task 2.6)
  migrate/                        geosound-migrate image (task 2.4)
  argocd/
    project.yaml                  AppProject geosound
    geosound-staging.yaml         Application, auto-sync, self-heal
    geosound-prod.yaml            Application, manual sync
    monitoring.yaml               Application for kube-prometheus-stack, Loki, Alloy
  monitoring/
    kube-prometheus-stack.values.yaml
    loki.values.yaml
    alloy.values.yaml
    dashboards/*.json             provisioned through ConfigMaps with the grafana_dashboard label
    alerts/geosound-rules.yaml    PrometheusRule
```

### 8.3 Per service

```yaml
# deploy/helm/geosound/values.yaml (excerpt)
image:
  registry: ghcr.io/<org>
  pullPolicy: IfNotPresent

services:
  gateway:
    port: 8080
    replicas: 2
    public: true
    hpa: { min: 2, max: 4, cpu: 70 }
    resources: { requests: { cpu: 100m, memory: 192Mi }, limits: { cpu: 500m, memory: 384Mi } }
    secrets: [geosound-jwt, geosound-infra]
  tour:
    port: 3002
    replicas: 2
    hpa: { min: 2, max: 4, cpu: 70 }
    migrate: true
    secrets: [geosound-db, geosound-jwt, geosound-infra, geosound-storage]
  moderation:
    port: 3003
    replicas: 1
    migrate: true
    secrets: [geosound-db, geosound-infra, geosound-ai]
  ai:
    port: 3004
    replicas: 1
    # 2Gi since #463: loading the embedding model peaks at about 1.5 GiB (1Gi was OOMKilled).
    resources: { requests: { cpu: 200m, memory: 1Gi }, limits: { cpu: "1", memory: 2Gi } }
    secrets: [geosound-db, geosound-infra, geosound-ai]
  # auth, media, notification, client follow the same shape
```

Every Deployment gets:

- `readinessProbe` on `/readyz` (period 10 s), `livenessProbe` on `/healthz` (period 20 s, failure threshold 3), `startupProbe` for `ai` (slow start).
- `strategy: RollingUpdate` with `maxUnavailable: 0`, `maxSurge: 1`.
- `terminationGracePeriodSeconds: 30` (the 0.5 shutdown stops by itself within 28 s). Set `SHUTDOWN_DELAY_MS` to a few seconds so the readiness probe takes the pod out before its HTTP server closes.
- `securityContext`: `runAsNonRoot: true`, `readOnlyRootFilesystem: true` where possible, drop all capabilities.
- Pod annotation with the ConfigMap checksum so a config change restarts the pods.
- `PodDisruptionBudget` with `minAvailable: 1` for services with 2 replicas.

Ingress: one host per environment (`staging.geosound.example.com`, `geosound.example.com`). `/` goes to `client`, `/api` goes to `gateway`. Only `client` and `gateway` are public. A `NetworkPolicy` allows traffic to internal services only from `gateway` and from the services that call them (for example `moderation` → `ai`), plus Prometheus scraping from `monitoring`.

RabbitMQ: one `RabbitmqCluster` (1 replica, 5 Gi PVC, `rabbitmq_prometheus` plugin on). Redis: one StatefulSet (`redis:7-alpine`, AOF on, 1 Gi PVC). Neither has an Ingress. The RabbitMQ management UI is opened with `kubectl port-forward`.

### 8.4 Configuration and secrets

Non-secret settings go to a ConfigMap generated from values (thresholds, timeouts, rate limits, feature flags such as `MODERATION_EVENTS_ENABLED`, `CHATBOT_ENABLED`, and `MEDIA_STORAGE=supabase`, task 0.7). Secrets are split by purpose so each Deployment mounts only what it needs:

| Secret | Keys (names from `.env.example`) |
| --- | --- |
| `geosound-db` | `DATABASE_URL_AUTH`, `DATABASE_URL_TOUR`, `DATABASE_URL_MODERATION`, `DATABASE_URL_AI`, `DATABASE_URL_DIRECT_AI`, `DATABASE_URL_MEDIA`, `DATABASE_URL_NOTIFICATION`, and the `DATABASE_URL_DIRECT_<SVC>` of the other services for migrations (task 2.4) |
| `geosound-jwt` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STATS_ACTOR_SALT` |
| `geosound-infra` | `RABBITMQ_URL`, `REDIS_URL`, `INTERNAL_SERVICE_TOKEN` |
| `geosound-ai` | `GEMINI_API_KEY`, `GROQ_API_KEY`, `LANGSMITH_API_KEY` |
| `geosound-smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| `geosound-storage` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `geosound-broker` | `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `REDIS_PASSWORD` (optional); read by the RabbitMQ and Redis pods only (task 2.3) |
| `geosound-payment` | `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`; read by `tour` only (UC25 tour payment, MoMo API v2). Optional in staging: without it Tour starts and a purchase answers 503 |

The non-secret payment settings are `tour` env values: `PAYMENT_RETURN_URL` (the client page `/payment/momo` of the environment's own host, set in each `deploy/envs/<env>/values.yaml`, and in `deploy/local/values*.yaml` for the laptop staging), `MOMO_IPN_URL` (default `<origin of PAYMENT_RETURN_URL>/api/tours/payments/momo/ipn`, so it must be a host MoMo can reach) and `MOMO_ENDPOINT` (default the sandbox `https://test-payment.momo.vn`). The laptop staging has no public host, so no IPN arrives there: the return page asks MoMo for the status instead. Before production: seal `geosound-payment` (it is required there), set `PAYMENT_RETURN_URL` in `deploy/envs/prod/values.yaml`, and set `MOMO_ENDPOINT` to the live endpoint with live merchant keys.

How secrets get into the cluster, in order of preference:

1. **Sealed Secrets**: the controller runs in the cluster; `kubeseal` encrypts each secret with the cluster's public key; the encrypted file is safe to commit under `deploy/envs/<env>/sealed/`. Argo CD deploys it like any other manifest.
2. Fallback: an admin creates them once with `kubectl create secret generic ... --from-env-file` from a file that lives only on their machine.

Plain secrets and `.env` files are never committed. GitHub Actions never holds application secrets; it only pushes images and commits tags.

### 8.5 Database migrations

`templates/migrate-job.yaml` renders one Job per service with `migrate: true`, using the same image and running `npx prisma migrate deploy` with the direct (non-pooler) URL (`DATABASE_URL_DIRECT_<SVC>`, the same command as the compose `migrate` service of task 0.6). The `media` and `ai` images have no Prisma CLI, so their Jobs use a small migrate image built by CI from the tour image plus `scripts/db/migrate.sh` and every `prisma` folder (the layout of the compose `migrate` service). Annotations `argocd.argoproj.io/hook: PreSync` and `hook-delete-policy: BeforeHookCreation` make Argo CD run it before the new pods start. A failed migration stops the sync, so the old version keeps running.

Migrations must be backward compatible with the running version (expand, deploy, then contract in a later release), because old and new pods run side by side during a rolling update.

### 8.6 Progress and deviations from the plan above

Status: 2.1 (#369), 2.3 (#371), 2.5 (#373), 2.4 (#372), 2.2 (#370) and 2.6 (#374) done. Phase 2 is built; the first install on the real VM follows the runbook. Scripts: `scripts/deploy/check-chart.sh`, `seal-secrets.sh`, `smoke-staging.sh`.

| # | Issue / PR | Result |
| --- | --- | --- |
| 2.1 | #369 | `deploy/helm/geosound`: one Deployment and one ClusterIP Service per entry of `.Values.services` (8 apps; the Service name is the app name, so the default URLs such as `http://auth:3001` work), one ConfigMap `geosound-config`. Each app's settings are merged over `.Values.defaults` (`geosound.app` helper; a key left empty in a values file keeps the default). One image tag for the whole stack, `global.image.tag`, with no default: rendering without it fails with a message naming the file to edit. Probes: startup and liveness on `/healthz`, readiness on `/readyz` (client: `/healthz` for both, nginx has no dependencies). Startup budget 120 s by default, 180 s for `ai` (measured about 30 s to the first `/healthz` at 1 CPU). Pods run with a numeric `runAsUser` (Node images: `USER node` is a name the kubelet cannot check, so 1000; AI 10001; client 101), read-only root file system with an `emptyDir` on `/tmp`, all capabilities dropped, `seccompProfile: RuntimeDefault`, no service account token, and `enableServiceLinks: false` (otherwise Kubernetes injects `AUTH_PORT=tcp://...`, which clashes with the app settings of the same name). The client gets a native `preStop` sleep of 5 s instead of `SHUTDOWN_DELAY_MS`. Deviation from 8.3: the secrets per app follow the code, not the excerpt. Each app reads only its own `DATABASE_URL` through `secretKeyRef` (AI: `DATABASE_URL_AI` and `DATABASE_URL_DIRECT_AI`) instead of mounting the whole `geosound-db`; gateway gets only `geosound-infra` (it does not verify JWTs); moderation gets no `geosound-ai` (it never calls an LLM); tour gets `geosound-ai` (translation) and no storage. `geosound-smtp` is optional in staging only: without it the auth service prints OTP codes to its log, which must not happen in prod. The `migrate`, `hpa`, `public` keys of 8.3 come with tasks 2.4 and 2.2. CI job `chart` runs `scripts/deploy/check-chart.sh`: `helm lint --strict`, `helm template` and `kubeconform -strict` (Kubernetes 1.31) for every `deploy/envs/*/values.yaml`, and checks that a release without a tag fails. Checked: 17 of 17 objects valid for staging and prod; on a local k3s in Docker (v1.31.4) with stand-in Postgres, RabbitMQ and Redis, all 8 app pods became Ready with no restart, a values change rolled `ai` with no downtime, and gateway `/readyz`, client `/` and ai `/readyz` answered 200 inside the cluster. |
| 2.3 | #371 | `templates/rabbitmq.yaml` and `templates/redis.yaml`: one StatefulSet each with a PVC from the default storage class (RabbitMQ 5 Gi, Redis 1 Gi), a ClusterIP Service named `rabbitmq` / `redis` (the default URLs of the apps), no Ingress. Deviation: no RabbitMQ Cluster Operator and no `RabbitmqCluster`. One node needs no clustering, the operator adds a controller and a CRD to run and upgrade, and a StatefulSet keeps the host name `rabbitmq-0`, so the node's data directory survives a restart (the role of `hostname: rabbitmq` in `docker-compose.prod.yml`). RabbitMQ `3.13-alpine` (pinned minor) with `rabbitmq_management` and `rabbitmq_prometheus` turned on by a ConfigMap (`enabled_plugins`, `rabbitmq.conf`: console logs, memory watermark 0.6, 256 MB disk floor); the management UI is reached with `kubectl port-forward svc/rabbitmq 15672`, metrics on 15692 for phase 4. Redis `7.4-alpine` with AOF; `REDIS_PASSWORD` is optional and turns on `requirepass` (then `REDIS_URL` must carry it). Broker credentials live in a new secret `geosound-broker` (`RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `REDIS_PASSWORD`), read by the broker pods only; the apps keep `RABBITMQ_URL` / `REDIS_URL` in `geosound-infra` (task 2.5 creates both from one input). Both pods run non-root with a read-only root file system and `fsGroupChangePolicy: OnRootMismatch`: with the default policy the kubelet makes every file of the volume group readable on each mount, RabbitMQ then refuses its `.erlang.cookie` and crash loops after the first restart (seen on k3s). `rabbitmq.enabled` / `redis.enabled: false` drop them for an external broker (checked in CI). Checked on the local k3s: the apps reconnected to the new broker without a restart, the 7 queues had one consumer each, a persistent message in a durable queue and a Redis key survived a pod delete, and the consumers came back by themselves after the broker restart (no app restart). |
| 2.5 | #373 | `scripts/deploy/seal-secrets.sh <env> <env-file>` reads a local env file (outside the repo, or `.env.<env>`, which git ignores), splits its keys into the secrets of section 8.4 and writes one `SealedSecret` per secret to `deploy/envs/<env>/sealed/<name>.yaml`, strict scope (bound to its name and to `geosound-<env>`). Values go through a pipe into `kubeseal` only: nothing plain is written to disk, the output lists key names. It checks everything before sealing anything: the required keys (the six `DATABASE_URL_<SVC>`, both JWT secrets, `RABBITMQ_URL`, `REDIS_URL`, `INTERNAL_SERVICE_TOKEN`) must be set, quotes and Windows line ends are removed, values are never expanded. Deviation: a seventh secret `geosound-broker` (task 2.3); without `RABBITMQ_URL` / `REDIS_URL` in the file the script builds them from `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `REDIS_PASSWORD` (refusing characters that would need URL encoding), so the broker and the apps share one input. `geosound-db` also takes the `DATABASE_URL_DIRECT_<SVC>` keys for the migrate Job (task 2.4). Encryption uses the controller's public certificate `deploy/envs/<env>/sealed-secrets.pem` (safe to commit, `kubeseal --fetch-cert`), so sealing needs no cluster access; without it kubeseal asks the cluster. No sealed file is committed yet: they are tied to the key of the real cluster (2.6). Fallback for an admin: `kubectl create secret generic <name> -n geosound-<env> --from-env-file=<file>` per secret. Two rules learnt on k3s: the controller does not take over a Secret it did not create (delete a hand-made one first), and pods read secrets at start (`envFrom`), so a changed secret needs `kubectl rollout restart`. Checked on the local k3s with Sealed Secrets v0.41.2: the script's error cases (missing file, missing keys, unsafe password), six sealed files with no plain value inside, the controller decrypted them into Secrets with the expected keys (built `RABBITMQ_URL` correct, quotes removed), and after a restart every app and both brokers became Ready with the sealed secrets, the 7 queues with one consumer each. |
| 2.4 | #372 | Migrate image `geosound-migrate` (`deploy/migrate/Dockerfile`, context the repo root, allow list `Dockerfile.dockerignore`): `node:20-alpine` with the same hardening as the service images (npm 11, `apk upgrade`, `USER node`), Prisma CLI 5.22.0 pinned in `deploy/migrate/package.json` with its engines downloaded at build time, `scripts/db/migrate.sh` and only `schema.prisma` plus `migrations/` of each service at `/migrations/<svc>` (no seed scripts). Entry point `migrate.sh`, default `deploy`; 342 MB uncompressed, no fixable HIGH or CRITICAL finding in Trivy. CI builds it as a ninth matrix entry of `images.yml` with the same tags, and the reuse rule retags it when `deploy/migrate`, `migrate.sh` and the six `prisma` folders did not change. Deviation from 8.3 and 8.5: one Job `geosound-migrate` instead of one per service with `migrate: true`. Every schema needs the same image anyway (media and AI have no Prisma CLI), one Job runs `migrate.sh deploy auth tour moderation notification media ai` in order, and the list is `.Values.migrate.services`. It is built from its own image, not from the tour image, so a tour change does not rebuild it. Each schema gets `DATABASE_URL_<SVC>` (required) and `DATABASE_URL_DIRECT_<SVC>` (optional, preferred by the script) from `geosound-db`. Hooks: `argocd.argoproj.io/hook: PreSync` for Argo CD and `helm.sh/hook: pre-install,pre-upgrade` for a plain `helm upgrade --install`, both deleted before the next run (the finished Job stays for `kubectl logs job/geosound-migrate`). `backoffLimit: 1`, `activeDeadlineSeconds: 600`, same pod hardening as the apps (uid 1000, read-only root, `/tmp` emptyDir for npm). Checked on the local k3s with an empty pgvector Postgres: the upgrade ran the Job first (15 s), which applied `0_init` to the six schemas (`extensions` with pgvector included), and `/api/tours` went from 500 (missing tables) to 200; a second upgrade reported "No pending migrations" for every schema; an upgrade with a config change and a Job that fails (`activeDeadlineSeconds: 1`) ended `failed` in the pre-upgrade hook with the ConfigMap and every Deployment unchanged, and the next upgrade was clean. Supabase is not migrated by the Job until it is baselined (task 0.6, with the user's go-ahead). |
| 2.2 | #370 | `ingress.yaml`: one Ingress (class `traefik`), `/api` to `gateway` and `/` to `client`, host from `ingress.host` (empty = any host, local tests only), TLS by cert-manager into `geosound-tls` when `ingress.clusterIssuer` names a ClusterIssuer (the issuers, the env hosts and the HTTP to HTTPS redirect come with the runbook, 2.6). `hpa.yaml`: `autoscaling/v2` on CPU for apps with `hpa: { min, max, cpu }` (prod: gateway and tour 2 to 4 at 70 %, replacing `replicas: 2`); the Deployment then has no `replicas`. Deviation: a scale-up window of 60 s besides the 5 min scale-down window, because on k3s a rollout always added a pod (a Node pod uses several times its 50m request while it starts); with the window a rollout restart kept 2 pods. `pdb.yaml`: `minAvailable: 1` only for apps with 2 or more pods (replicas or `hpa.min`), so none in staging. `networkpolicy.yaml`: default deny of incoming traffic for the namespace, then one policy per app on its `http` port: from Traefik (`kube-system`, `app.kubernetes.io/name: traefik`) for `public: true` apps (client, gateway), from the apps in its `allowFrom`, and from the `monitoring` namespace. Deviation from the issue text: the callers follow the code, not the excerpt: gateway to every service, moderation and tour (translation) to ai, notification to auth (contributor email lookup, #258); RabbitMQ (and its metrics port for monitoring) and Redis accept the apps that load `geosound-infra`, the secret with their URLs (so not the client). Egress stays open (Supabase, LLM providers, SMTP). A rule never has an empty `from`; `check-chart.sh` now checks that an app without callers gets no policy (default deny wins) and that staging renders no PDB. Fix found on the way: notification has no default `AUTH_SERVICE_URL`, so the email lookup was off in the cluster since 2.1; the ConfigMap now carries the six service URLs, like the compose `.env`. Checked on the local k3s: 35 objects valid for staging, 39 for prod; through Traefik `/`, `/tours` and `/api/tours` answered 200 and `/api/nope` 404; gateway to auth, notification to auth, tour and moderation to ai answered 200, while media to auth or ai, tour to moderation and a stray pod to auth, ai and gateway were refused; every probe kept passing and the 7 queues kept one consumer each; with `hpa` set on the gateway the autoscaler read the CPU use (2 % of 70 %), scaled to 2 (the minimum), and its PDB was created with `minAvailable: 1`. |
| 2.6 | #374 | Runbook `docs/04-guides/k3s-cluster.md`: part A for the real VM (ports, SSH, k3s v1.31.4 keeping Traefik and local-path, cert-manager v1.21.3, Sealed Secrets v0.41.2 with a key backup, namespaces, GHCR pull secret, sealing, install with the Let's Encrypt staging issuer first, smoke check), part B for a laptop (k3s in Docker, migrate image imported into containerd until CI publishes it, stand-ins), and a troubleshooting section. `deploy/README.md`: layout, install or upgrade, rollback (the image tag and manifests go back, migrations do not: they must stay backward compatible), secrets, smoke check, adding a service (values entry, `allowFrom`, image matrix, migrate image). `deploy/cluster/`: `namespaces.yaml` and `cluster-issuers.yaml` (`letsencrypt-staging`, `letsencrypt-prod`, HTTP-01 through Traefik, no contact email). Env files: staging and prod hosts (placeholders `*.geosound.example.com` until the domain is chosen) with `letsencrypt-prod`. Chart: when `ingress.clusterIssuer` is set and `redirectHttps` is on (default), a Traefik `Middleware` `redirect-https` turns plain HTTP into a 301 to HTTPS (Traefik 2.11 answers 301, not 308). Finding on the way: with the default deny of 2.2, cert-manager's HTTP-01 solver pod (port 8089) was unreachable, so no certificate could ever be issued or renewed; a NetworkPolicy `acme-http01-solver` now lets Traefik in whenever an issuer is set (checked with a fake solver: 200 with the policy, 502 without; the solver's own Ingress has no redirect, so the challenge stays on HTTP). `check-chart.sh` now validates CRDs (the Traefik Middleware) with the community schema catalog: 41 objects valid for prod, 37 for staging. `scripts/deploy/smoke-staging.sh <base-url> [namespace]`: plays a new contributor through the Ingress (client page, public tours, register, OTP read from the auth log, verify, login, new tour, new place) and waits until moderation approves the place; `SMOKE_REJECT=1` also expects a rejection from the AI stub. Deviation: Argo CD (8.1 step 4) moves to phase 3, the runbook deploys with Helm. `deploy/local/` (Postgres with pgvector, the e2e AI stub limited to moderation by a NetworkPolicy, values without host and issuer, a dummy env file) replaces Supabase and the LLM keys on a laptop. Checked on the local k3s from an empty namespace, following part B: six sealed secrets decrypted, migrate Job applied every schema, all pods Ready, smoke check OK (place `approved`, `E2E_REJECT` place `rejected`); with a test host and `letsencrypt-staging`, HTTP answered 301 and HTTPS 200, cert-manager created the Certificate `geosound-tls`; cert-manager accepted `cluster-issuers.yaml` (server dry run). Bug found: on a fresh install the AI chatbot indexer tries RabbitMQ 10 times 3 s apart (`start_indexer`, about 30 s) and then gives up for the life of the pod, so `ai` stays not ready (`/readyz` 503, `"rabbitmq":"down"`) and moderation, chat and translation lose it; the Node services reconnect by themselves. Fixed in #375 (PR #377): the first connection is retried without a limit in a background task, so the runbook needs no workaround. Supabase was not touched. |

## 9. Phase 3: continuous delivery with Argo CD

### 9.1 Flow

```text
merge a pull request develop → staging
  → images.yml builds sha-abc1234 (or retags the unchanged images, so the tag exists for every app)
  → promote job: sets the one global tag global.image.tag in deploy/envs/staging/values.yaml
    on branch staging, commits "chore: deploy sha-abc1234 to staging" with GITHUB_TOKEN
  → Argo CD (auto-sync, self-heal, prune) applies the chart
  → PreSync: migrate Jobs
  → rolling update, readiness gates traffic
  → PostSync: smoke test Job, read only (curl the readiness path of each app, GET /api/tours;
    no login and no write, decision P3-2)
  → result posted to the Discord channel (Argo CD Notifications)

tag v1.4.0 on main
  → images.yml tags the same images v1.4.0 (no rebuild: retag sha-abc1234)
  → promote job opens a PR that changes deploy/envs/prod/values.yaml
  → a reviewer approves and merges (GitHub environment "production" with required reviewers)
  → an admin clicks Sync in Argo CD for geosound-prod (manual sync)
```

The promote job (`ci.yml`, job `promote`) pushes with the workflow's own `GITHUB_TOKEN` and `contents: write` (decision P3-4), not with a `DEPLOY_BOT_TOKEN`: no secret from the repo owner is needed, and a commit pushed with `GITHUB_TOKEN` starts no workflow, so there is no loop and no `paths-ignore`. There is one image tag for the whole stack (`global.image.tag`), not one per service: `images.yml` gives every app the tag of every build. The bot commits only on `staging` (P3-5); `develop` keeps an old tag that nobody edits, so the `develop` → `staging` pull request never conflicts with the bot commits.

### 9.2 Rollback

- Fast: Argo CD UI → History → Rollback to the previous synced revision (auto-sync is paused while rolled back).
- Clean: `git revert` the commit that changed the tag; Argo CD syncs the old tag.
- Database: migrations are forward only. A bad migration is fixed with a new migration, which is why phase 0.6 and section 8.5 require backward-compatible changes.

### 9.3 Release checklist (production)

1. Staging has run the same images for at least one day with no firing alerts.
2. CI, Trivy and the staging smoke test are green.
3. Migrations in this release are backward compatible.
4. `CHANGELOG.md` updated, tag `vX.Y.Z` created (semantic versioning).
5. After the sync: Grafana overview shows no rise in 5xx or p95 latency for 15 minutes.

### 9.4 Progress and deviations from the plan above

Status: 3.1 (#383), 3.2 (#386), 3.3 (#388), 3.4 (#394) and 3.5 (#390, documentation) done: phase 3 is built and runs on the laptop cluster. Work order: `deployment-phase3-implementation.md`.

Decisions taken with the user for this phase (they change sections 9.1 to 9.3 where they differ):

- **P3-1** The cluster never migrates Supabase: the laptop values turn the PreSync migrate Job off; migrations go through `docker compose --profile migrate run --rm migrate deploy <svc>`.
- **P3-2** The PostSync smoke test has no login and writes nothing: `/readyz` of every app and `GET /api/tours` only. `scripts/deploy/smoke-staging.sh` (it registers accounts) never runs against the Supabase-backed cluster.
- **P3-3** Secrets stay out of Git and out of Argo CD: Argo CD manages only the chart, so it never prunes the hand-applied secrets (database URLs, Discord webhook).
- **P3-4** The promote job pushes with `GITHUB_TOKEN` and `contents: write`, not `DEPLOY_BOT_TOKEN` (section 9.1).
- **P3-5** Argo CD tracks branch `staging`. Deploying means merging a pull request `develop` → `staging`; bot commits land only on `staging`.
- **P3-6** Production (the second half of 9.1) is documentation only in this phase: there is no prod cluster, and the `production` environment needs the repo owner.

| # | Issue / PR | Result |
| --- | --- | --- |
| 3.1 | #383 | Argo CD v3.6.1 (chart `argo/argo-cd` 10.18.0, `deploy/argocd/values-local.yaml`: no Dex, ApplicationSet controller at 0 replicas, notifications on for 3.4, small limits, `server.insecure` behind a port-forward on `127.0.0.1:4467`, annotation tracking set explicitly so `app.kubernetes.io/instance` in the immutable selectors is left alone) on the laptop k3s. Application `deploy/argocd/apps/geosound-staging.yaml`: branch `staging`, release name `geosound`, values `envs/staging` + `local` + the new `local/values-supabase.yaml` (laptop stack on the team Supabase: migrate Job off, real `ai`, media in `/tmp`), automated sync with prune and self-heal, server-side apply. Runbook section B5 (install, UI password into a file, adoption, never `helm upgrade` / `helm uninstall` afterwards, pause auto-sync, back to compose). Checked on the laptop: the Application adopted the hand-installed Helm release (revision 4, `sha-ba8649d`) and became Synced and Healthy; `/api/tours` answered 200 with the real data. Deviation: adoption rolled all 8 Deployments once. `checksum/config` hashes the rendered ConfigMap template, revision 4 was installed from a Windows checkout with CRLF line ends, and Argo CD renders from Git with LF (an LF render gives exactly Argo CD's hash); `.gitattributes` now keeps `deploy/**` in LF. Before adoption the `ai` pod was recreated once: its image predates #375 and had given up on RabbitMQ (`/readyz` 503). Since `staging` has no chart yet (task 3.2, U1), the live Application tracked the task branch and then a temporary branch: a harmless commit there (an HPA for `client`, min = max = 1) was applied by automated sync about 3.5 minutes after the push, and its revert pruned the HPA, with no pod restart; a hand change of `client` replicas to 2 was put back by self-heal within seconds. The temporary branch is deleted. Supabase was not touched. |
| 3.2 | #386 | CI job `promote` in `ci.yml`: after `images`, only on a push to `staging` (never on `develop`, `main`, tags or pull requests), job permissions `contents: write` only, concurrency group `promote-staging` without cancelling. It checks out the tip of `staging`, computes `sha-<7>` the same way as `images.yml`, and writes it into `global.image.tag` of `deploy/envs/staging/values.yaml`, then commits `chore: deploy <tag> to staging` as `github-actions[bot]` and pushes (one `git pull --rebase` and a second push if `staging` moved, else the job fails). The step summary gives the tag and the commit link. Order guard: when the running tag was built from this commit or a later one (`git merge-base --is-ancestor`), a newer build was promoted first and the job only logs it. Deviation: `yq -i` (v4.44.3, pinned by checksum) drops the blank lines and rewrites `{ a: b }` maps of the file, so `sed` changes the one line and `yq` checks the new value; the job also checks that the diff is exactly one line of that file. The tag comment in the staging values says it is written on `staging` only. Checked: `actionlint` 1.7.7 with shellcheck is clean; in a test repository the step wrote over an unknown tag, skipped an older build and a rerun of the same build, and wrote a newer one, each time a one-line diff. |
| 3.3 | #388 | `templates/smoke-job.yaml`: Job `geosound-smoke`, Argo CD `PostSync` hook (`BeforeHookCreation`) and Helm `post-install,post-upgrade` (`before-hook-creation`), so the last run stays for `kubectl logs job/geosound-smoke`. `backoffLimit: 1`, `activeDeadlineSeconds: 300`, same pod hardening as the migrate Job (uid 100 of the image, read-only root, all capabilities dropped, `RuntimeDefault`, no service account token). Image `curlimages/curl:8.23.0`, pinned by digest. The script is rendered from `.Values.services`: one `ready` line per enabled app on its port and readiness path (client `/healthz`), then `GET http://gateway:8080/api/tours?limit=1` must answer 200 with `application/json` and a JSON body (gateway mounts `/api/tours` on the tour service, the route the Ingress forwards). Each check retries every 3 s for `smoke.checkTimeoutSeconds` (120); the first failure ends the Job. Read only, no login (P3-2). `smoke.enabled` is off by default and on in staging; with it on, the NetworkPolicy of every app also accepts the pods `app.kubernetes.io/name: smoke` of the release (an app with no other caller still gets a rule with a source, never an empty `from`). `check-chart.sh` checks that the staging render has one PostSync Job with one check per Deployment, that every app policy lets it in, and that prod (smoke off) renders no Job. Checked on the laptop cluster with the Application on the task branch: the sync ran the hook, 9 of 9 checks OK in 16 s, no pod restarted (only the policies changed). Then, with `/spec/replicas` of `tour` ignored by the Application for the test only (`ignoreDifferences` and `RespectIgnoreDifferences` on the live object, removed afterwards) and `tour` at 0 replicas, a sync ended **Failed** ("one or more synchronization tasks completed unsuccessfully"): `FAIL tour http://tour:3002/readyz (last status 000)` in both pods of the Job, after 4.5 minutes. With `tour` back at 1, the next sync was green again. A plain `kubectl scale` is not enough for that test: self-heal and the sync put the replicas back before the hook runs. |
| 3.4 | #394 | Argo CD notifications (`deploy/argocd/values-local.yaml`): webhook service `discord` (`url: $discord-webhook-url`, JSON), templates `app-sync-succeeded`, `app-sync-failed`, `app-health-degraded` (Discord `content` built with `toJson`, `allowed_mentions` empty so no message pings anyone) and triggers `on-sync-succeeded`, `on-sync-failed` (both `oncePer` the operation start, so two syncs in a row each get a message), `on-health-degraded`. A message gives the app, the image tag (read from the gateway image in `.app.status.summary.images`, else the short revision), the revision and the link to the app; the failure message adds the operation message and every failed hook or resource (for example `Job/geosound-smoke: ...`), cut to 900 characters. `notifications.secret.create: false`: the Secret `argocd-notifications-secret` (key `discord-webhook-url`) is made by hand from `WEBHOOK_DISCORD_URL` of the root `.env` without printing it (U2, runbook B5; the upgrade deleted the empty Secret the chart had made). The Application subscribes with three `notifications.argoproj.io/subscribe.*.discord` annotations. The templates were rendered offline first (Go `text/template` with sprig, the live Application as input, a forced failure added): valid JSON each time. Checked on the laptop cluster, also as the first end to end run of 3.2 and 3.3 (U1): PR #393 `develop` -> `staging` merged; CI on `staging` reused the develop images as `sha-c96c36a` and the job `promote` pushed one bot commit `chore: deploy sha-c96c36a to staging` (`c29345d`, one line), which started no workflow; Argo CD on `staging` synced it in 31 s, every app on the new tag, smoke 9 of 9 OK, success message sent. With the 3.3 failure method (`tour` at 0 replicas, its replicas ignored for the test only), the sync failed and the failure message was sent; after the restore, a success message. Four messages in the channel in all (one success before the release, then success, failure, success), no error in the controller log. Deviation: the controller logs `[DEBUG] POST <webhook URL>` for each message (go-retryablehttp default logger, no option in notifications-engine), so the URL is in that pod log, though never in Git, the values or our output; the runbook says to read that log through `sed`, drop those lines before phase 4 ships logs, and to rotate the webhook if it leaks. |
| 3.5 | #390 | Documentation only (P3-6): `docs/04-guides/release-production.md`, indexed in `docs/04-guides/README.md`. It covers which branch writes which image tag (`staging` by the bot, prod only on `main` through a reviewed pull request), the release candidate on `staging`, the merge `staging` → `main` and the tag `vX.Y.Z` on that merge commit (`images.yml` then only retags the images built on `main`, the run summary says `reused`), the pull request on `deploy/envs/prod/values.yaml`, the `production` environment and the branch protection of `main` (both for the repo owner), a manual Sync of `geosound-prod` (example Application in the guide, not committed, no automated sync), the release checklist of 9.3 with what exists today (release notes in the pull request until a `CHANGELOG.md` exists, the gateway log until Grafana), rollback (9.2, migrations only go forward) and a table of what is still missing: the prod cluster, DNS, prod secrets and database, a GHCR pull secret if the packages stay private, the environment, the release job. Nothing was created on GitHub or in a cluster. |

## 10. Phase 4: observability

### 10.1 Stack

Install through Argo CD (`deploy/argocd/monitoring.yaml`):

- `kube-prometheus-stack`: Prometheus Operator, Prometheus (retention 7 days, 10 Gi PVC), Alertmanager, Grafana, node-exporter, kube-state-metrics.
- `loki` in single binary mode (retention 7 days, 10 Gi PVC).
- `alloy` as a DaemonSet that tails pod logs and sends them to Loki with the labels `namespace`, `app`, `service`.
- `prometheus-redis-exporter` next to Redis.

Grafana is reachable at `grafana.<domain>` behind HTTPS with its own admin password (stored as a secret), anonymous access off.

### 10.2 Application metrics

Node services (`prom-client`), added once in `shared/` and enabled in every `src/index.js`:

| Metric | Type | Labels |
| --- | --- | --- |
| `http_requests_total` | counter | `service`, `method`, `route` (Express route pattern, not the raw URL), `status` |
| `http_request_duration_seconds` | histogram (0.05 to 5 s) | `service`, `method`, `route` |
| default process metrics | gauges | heap, event loop lag, GC, open handles |
| `events_consumed_total` | counter | `service`, `event`, `result` (`ack`, `nack`, `skip`) |
| `events_published_total` | counter | `service`, `event` |

The `/metrics` endpoint listens on the service port but is not routed by the gateway and is blocked from outside by the NetworkPolicy.

AI and Moderation business metrics (owned by the AI part):

| Metric | Where | Labels |
| --- | --- | --- |
| `moderation_cases_total` | Moderation | `kind` (`place`, `tour`), `verdict` (`Pass`, `Warning`, `Reject`), `source` (`ai`, `geo`) |
| `moderation_ai_failed_total` | Moderation | `kind`, `reason` (`timeout`, `503`, `401`) |
| `moderation_case_duration_seconds` | Moderation | `kind` (from `*.submitted` to the published result) |
| `moderation_pending_cases` | Moderation | gauge, cases waiting for the sweeper |
| `llm_requests_total` | AI | `provider` (`gemini`, `groq`), `task` (`place`, `tour`, `chat`), `outcome` (`ok`, `429`, `5xx`, `timeout`, `blocked`) |
| `llm_request_duration_seconds` | AI | `provider`, `task` |
| `llm_fallback_total` | AI | `from`, `to` |
| `chatbot_requests_total` | AI | `outcome` |
| `chatbot_first_token_seconds` | AI | histogram |
| `chatbot_indexer_events_total` | AI | `event`, `result` |

Python: `prometheus-fastapi-instrumentator` for HTTP metrics plus `prometheus_client` counters in the moderation and chatbot code. No label may contain user content, ids or emails (cardinality and privacy).

Infrastructure metrics come for free: RabbitMQ (`rabbitmq_queue_messages_ready`, `rabbitmq_queue_messages_unacked`), Redis exporter, node-exporter, kube-state-metrics (restarts, OOM kills, pending pods).

Scraping: `templates/servicemonitor.yaml` creates one `ServiceMonitor` per service with the label `release: kube-prometheus-stack`.

### 10.3 Dashboards (JSON in `deploy/monitoring/dashboards/`)

1. **GeoSound overview**: request rate, error rate (5xx / all), p50 / p95 / p99 latency per service (RED), pods ready vs desired, last deploy annotation from Argo CD.
2. **Infrastructure**: node CPU, memory, disk; per-pod CPU and memory vs limits; restarts and OOM kills.
3. **Messaging**: messages ready and unacked per queue, publish and consume rates, consumer count, Redis memory and ops.
4. **AI and Moderation**: verdict distribution, cases per minute, time to verdict, `ai_failed` and pending cases, LLM latency and outcome per provider, Gemini → Groq fallbacks, 429 rate against the free tier limit (5 requests per minute), chatbot request rate and first-token latency.
5. **Logs**: Loki panel filtered by namespace, service and level, linked from the overview by `reqId`.

### 10.4 Alerts (`deploy/monitoring/alerts/geosound-rules.yaml`)

| Alert | Expression (idea) | For | Severity |
| --- | --- | --- | --- |
| `PodCrashLooping` | restarts increase > 3 in 15 min | 5 m | critical |
| `HighErrorRate` | 5xx / all > 5 % per service | 5 m | critical |
| `HighLatency` | p95 > 1 s per service (excluding `ai` and chat streaming) | 10 m | warning |
| `QueueBacklog` | `rabbitmq_queue_messages_ready` > 100 | 10 m | warning |
| `ModerationStuck` | `moderation_pending_cases` > 20 | 15 m | warning |
| `LLMProviderDown` | Gemini outcome not `ok` > 50 % | 10 m | warning |
| `NodeMemoryHigh` | node memory used > 85 % | 10 m | warning |
| `DiskAlmostFull` | free disk < 15 % | 10 m | critical |
| `CertExpiringSoon` | certificate expires in < 14 days | 1 h | warning |
| `TargetDown` | `up == 0` for a GeoSound target | 5 m | critical |

Alertmanager sends `critical` and `warning` to a Discord webhook (secret), groups by `alertname` and `namespace`, and silences staging at night if it gets noisy. Each alert has a `runbook_url` pointing to `deploy/README.md#<alert>`.

### 10.5 Tracing (optional)

OpenTelemetry SDK in the gateway and Node services, export to Grafana Tempo, propagate `traceparent` through HTTP and RabbitMQ message headers. LLM calls stay traced in LangSmith. Do this only after phases 0 to 4 are stable.

### 10.6 Progress and deviations from the plan above

Status: 4.1 (#398), 4.2 (#399), 4.3 (#400), 4.4 (#401), 4.5 (#402), 4.6 (#403) and 4.7 (#404) built: phase 4 runs on the laptop cluster. Work order and decisions P4-1 to P4-8: `deployment-phase4-implementation.md`. Runbook: `docs/04-guides/k3s-cluster.md` B6, alerts in `deploy/README.md`.

Laptop sizes (P4-3, they replace 10.1 on the laptop only; 10.1 stays the target for a real cluster):

| Component | Laptop | Plan 10.1 |
| --- | --- | --- |
| Prometheus | retention 2 days or 2 GB, 3 Gi `local-path` volume | 7 days, 10 Gi |
| Loki | SingleBinary, retention 48 hours, 3 Gi volume, memcached caches off | 7 days, 10 Gi |
| Grafana | no volume (dashboards and datasources come from Git), port-forward `127.0.0.1:4468` | `grafana.<domain>` behind HTTPS |
| Prometheus / Alertmanager | port-forward `127.0.0.1:4469` / `:4470`, no Ingress | internal |
| Memory | about 1 GiB for the whole stack (requests 1160 Mi) | |

| Task | Issue | What was built and checked |
| --- | --- | --- |
| 4.1 | #398 | PR #409. `deploy/argocd/apps/monitoring.yaml`: four Applications (kube-prometheus-stack 93.3.0, Loki 7.6.0, Alloy 1.16.0, `monitoring-config` for `deploy/monitoring/`), charts pinned, values from `staging`, server-side apply. Grafana admin login from a Secret made by hand, anonymous access off. Alloy ships pod logs with the labels `namespace, pod, container, app, service, level`; it drops the `[DEBUG] POST` lines of the Argo CD notifications controller and rewrites any Discord webhook URL, so the webhook of 3.4 never reaches Loki. |
| 4.2 | #399 | PR #405. `shared/metrics` (`http_requests_total`, `http_request_duration_seconds`, `/metrics`) and `useMetrics` in `shared/rabbitmq` (`events_published_total`, `events_consumed_total`) in auth, tour, media, notification and the gateway. `route` is the route template or the mount prefix, never a raw URL. The gateway answers 404 for `/api/.../metrics`. Bug found on staging (#412, PR #413): the auth image had no `node_modules` for `shared/`, so the new auth pod crashed on `prom-client`; the Dockerfile now installs them like the other images. |
| 4.3 | #400 | PR #406. AI: HTTP metrics (`prometheus-fastapi-instrumentator`, label `handler`), `llm_requests_total`, `llm_request_duration_seconds`, `llm_fallback_total`, `chatbot_requests_total`, `chatbot_first_token_seconds`, `chatbot_indexer_events_total`; every label clamped to a closed set. |
| 4.4 | #401 | PR #408. Moderation: `moderation_cases_total`, `moderation_ai_failed_total`, `moderation_case_duration_seconds`, `moderation_pending_cases` (refreshed by the retry sweeper); no id in any label. |
| 4.5 | #402 | PR #407. `templates/servicemonitor.yaml`: one ServiceMonitor per backend app, RabbitMQ (aggregated metrics, so no per-queue series) and a `redis_exporter` sidecar; off by default, on in `deploy/local/values.yaml`; NetworkPolicy opens the metrics ports to `monitoring` only. Checked: every GeoSound target up; `/api/<service>/metrics` through Traefik answers 404. |
| 4.6 | #403 | PR #417. Five dashboards in the folder `GeoSound` (Overview, Infrastructure, Messaging, AI and Moderation, Logs), loaded by the Grafana sidecar from a `configMapGenerator`. Deviations: rollouts are marked from kube-state-metrics (Argo CD is not scraped); the messaging dashboard shows RabbitMQ totals; AI HTTP panels group by `handler`. Every panel query was run through Grafana `/api/ds/query`: no datasource error; the panels that stay empty had no traffic of that kind. Still open on #403: one moderation submission and one chat message on staging (real Gemini calls), then every AI and Moderation panel must show data. |
| 4.7 | #404 | PR #411. `deploy/monitoring/alerts/geosound-rules.yaml`: PodCrashLooping, HighErrorRate, HighLatency, QueueBacklog, ModerationStuck, LLMProviderDown, NodeMemoryHigh, DiskAlmostFull, TargetDown (fires when a job that had a target in the last hour has no target up, so a Deployment scaled to 0 also fires). Alertmanager posts `team="geosound"` and `severity="critical"` to `#geosound-alerts` with `webhook_url_file` from a Secret made by hand (P4-1, P4-2); default receiver `null`. Noise fixes found on the laptop (#414, PRs #415, #416): `DiskAlmostFull` skips the `9p` / `drvfs` mounts of the Windows host, and the chart's API server SLO group (`KubeAPIErrorBudgetBurn`) is off as a whole group, because disabling its one alert by name left `rules: null`, which the PrometheusRule CRD rejects. Checked on the laptop cluster after the release `sha-31c881e` (PR #418): with auto-sync paused for the test only, `notification` at 0 replicas made `TargetDown` fire after about 5 minutes and post to `#geosound-alerts`; back at 1 replica it resolved and posted again (Alertmanager `alertmanager_notifications_total{integration="discord"}` 6, failed 0). The same rule had already caught a real outage: the auth crash of #412 fired `TargetDown` for `auth` and resolved when the fixed image was deployed. |

Later work (task 4.8, P4-7): `CertExpiringSoon` (needs TLS and a domain), tracing (10.5), Grafana behind an Ingress, the sizes of 10.1 on the real VM.

## 11. Security checklist

- Non-root containers, read-only root filesystem where possible, no privileged pods.
- Only ports 80 and 443 public; RabbitMQ, Redis, Prometheus and Argo CD are internal or behind HTTPS with login.
- NetworkPolicies between services (section 8.3).
- Secrets split per purpose, sealed in git or created by hand; no secret in images, logs, metrics labels or CI.
- Trivy scan in CI; Dependabot for npm, pip, GitHub Actions and base images.
- Branch protection on `staging` and `main`; required reviewers for the `production` GitHub environment.
- Supabase: production uses its own project or schemas, and backups are enabled there. RabbitMQ and Redis PVCs are backed up with a nightly VM snapshot.

## 12. Timeline and ownership

Rough effort for one person who knows the codebase; it shrinks if the team splits phases.

| Phase | Work | Effort | Suggested owner |
| --- | --- | --- | --- |
| 0 | Production-ready services (10 tasks) | 4 to 6 days | each service owner, AI part does `ai` and `moderation` |
| 1 | Image pipeline | 1 day | DevOps volunteer |
| 2 | Cluster, Helm chart, secrets, migrations | 3 to 4 days | DevOps volunteer |
| 3 | Argo CD, promote job, smoke tests | 2 days | DevOps volunteer |
| 4 | Monitoring stack, metrics, dashboards, alerts | 3 to 4 days | stack: DevOps; AI and Moderation metrics and dashboard: AI part |
| | Docs and runbook (`deploy/README.md`, this file) | 1 day | docs owner |

Order: 0 → 1 → 2 (staging only) → 3 → 4 → production. Phase 4 can start in parallel with phase 3 once the chart deploys.

Each task becomes one GitHub issue with the label `deploy`, one branch, one PR, following the git rules in `CLAUDE.md` section 5.

## 13. Demo script

1. Show the Argo CD UI: both environments synced and healthy.
2. Merge a small visible change to `staging`. Watch the image build, the bot commit, the Argo CD sync and the rolling update. Grafana overview shows no error spike.
3. Run `k6 run load/tours.js` (50 virtual users for 3 minutes). The HPA scales `gateway` and `tour` from 2 to 4 pods; latency stays under the alert threshold.
4. Delete a `tour` pod with `kubectl delete pod`. Kubernetes recreates it; requests keep working through the second replica.
5. Scale `ai` to 0. Submit a place: the moderation case goes to `ai_failed`, the pending gauge rises, `ModerationStuck` fires in Discord. Scale `ai` back to 1: the sweeper retries and the case gets its verdict.
6. Roll back the change from the Argo CD history.

## 14. Risks and open questions

| Risk / question | Mitigation |
| --- | --- |
| 8 GB is tight for two environments and monitoring | Staging with 1 replica and smaller limits, `ai` on demand; or staging on a laptop with k3d |
| Gemini free tier (5 requests per minute) is shared by staging and prod | Separate API keys per environment; staging uses the AI stub for load tests |
| Moving from `db push` to migrations on live Supabase schemas | Baseline migration marked as applied, tested first on a disposable Postgres, needs the user's go-ahead. Read-only `migrate check` against Supabase before `migrate baseline` (task 0.6) |
| Who owns the VM, domain and secrets | Decide in the team before phase 2 |
| Old and new pods run together during rollout | Additive event contracts (already the rule) and backward-compatible migrations |
| ngrok demo still needed? | Not after phase 2: the HTTPS domain replaces it; keep `scripts/demo` for local demos |
