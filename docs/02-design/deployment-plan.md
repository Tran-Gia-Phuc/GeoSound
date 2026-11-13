# Deployment plan: CI/CD, Kubernetes, Prometheus and Grafana

Status: **in progress** (proposal 2026-11-09). Phase 0 tasks 0.1 to 0.4 and 0.6 are done (section 6.1); the rest is not built yet. Later phases need the team's agreement, because they touch every service and the shared infrastructure.

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
| 0.6 | #352 | Baseline `prisma/migrations/0_init` (plus `migration_lock.toml`) for all six schemas, generated offline with `prisma migrate diff --from-empty`; the AI one also holds `pre-push.sql` (pgvector in `extensions`) and `post-push.sql` (CHECK constraints, partial and HNSW indexes). `auth` and `moderation` no longer run `db push` in their `CMD` (dev and prod). One-shot compose service `migrate` (profile `migrate`, tour image, every `prisma` folder mounted) runs `scripts/db/migrate.sh` with `deploy`, `status`, `check` (read-only drift check) and `baseline` (`migrate resolve --applied 0_init`), over `DATABASE_URL_DIRECT_<SVC>`. CI replays the migrations on a pgvector service container and fails when they do not build `schema.prisma` (`scripts/db/check-migrations.sh`). `.gitattributes` keeps `migration.sql` and `*.sh` in LF, because Prisma checksums each applied file. Checked on a disposable Postgres: `migrate deploy` from empty gives no diff for any schema, the AI constraints and indexes exist, and a schema made by `db push` baselines to "No pending migrations". Known exception: Prisma 5 cannot express the HNSW index, so a diff always proposes dropping it; both scripts ignore that line. Media and AI images have no Prisma CLI: their migrate Job will use a small migrate image (section 8.5). Supabase itself is baselined separately, after a read-only `check`, with the user's go-ahead. Team rule: no more `db push` (`docs/04-guides/supabase-access.md` section 4). |

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

## 8. Phase 2: Kubernetes cluster and Helm chart

### 8.1 Cluster setup (one time, documented as a runbook)

1. Create the VM, open ports 22, 80 and 443 only. SSH with keys, no password login, `ufw` enabled.
2. Install k3s (`curl -sfL https://get.k3s.io | sh -`), keep Traefik and the local-path storage class.
3. Install cert-manager (Helm) and a `ClusterIssuer` for Let's Encrypt (staging issuer first, then production).
4. Install Argo CD (Helm) in `argocd`; expose its UI through an Ingress with HTTPS, or use `kubectl port-forward` only.
5. Install the RabbitMQ Cluster Operator.
6. Create namespaces `geosound-staging`, `geosound-prod`, `monitoring`.
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
      migrate-job.yaml            prisma migrate deploy, Argo CD PreSync hook
      rabbitmq.yaml               RabbitmqCluster resource
      redis.yaml                  StatefulSet + Service + PVC
  envs/
    staging/values.yaml           image tags, host name, replicas, limits
    prod/values.yaml
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
    resources: { requests: { cpu: 200m, memory: 512Mi }, limits: { cpu: "1", memory: 1Gi } }
    secrets: [geosound-db, geosound-infra, geosound-ai]
  # auth, media, notification, client follow the same shape
```

Every Deployment gets:

- `readinessProbe` on `/readyz` (period 10 s), `livenessProbe` on `/healthz` (period 20 s, failure threshold 3), `startupProbe` for `ai` (slow start).
- `strategy: RollingUpdate` with `maxUnavailable: 0`, `maxSurge: 1`.
- `terminationGracePeriodSeconds: 30` (phase 0.5 needs at most 20 s).
- `securityContext`: `runAsNonRoot: true`, `readOnlyRootFilesystem: true` where possible, drop all capabilities.
- Pod annotation with the ConfigMap checksum so a config change restarts the pods.
- `PodDisruptionBudget` with `minAvailable: 1` for services with 2 replicas.

Ingress: one host per environment (`staging.geosound.example.com`, `geosound.example.com`). `/` goes to `client`, `/api` goes to `gateway`. Only `client` and `gateway` are public. A `NetworkPolicy` allows traffic to internal services only from `gateway` and from the services that call them (for example `moderation` → `ai`), plus Prometheus scraping from `monitoring`.

RabbitMQ: one `RabbitmqCluster` (1 replica, 5 Gi PVC, `rabbitmq_prometheus` plugin on). Redis: one StatefulSet (`redis:7-alpine`, AOF on, 1 Gi PVC). Neither has an Ingress. The RabbitMQ management UI is opened with `kubectl port-forward`.

### 8.4 Configuration and secrets

Non-secret settings go to a ConfigMap generated from values (thresholds, timeouts, rate limits, feature flags such as `MODERATION_EVENTS_ENABLED`, `CHATBOT_ENABLED`). Secrets are split by purpose so each Deployment mounts only what it needs:

| Secret | Keys (names from `.env.example`) |
| --- | --- |
| `geosound-db` | `DATABASE_URL_AUTH`, `DATABASE_URL_TOUR`, `DATABASE_URL_MODERATION`, `DATABASE_URL_AI`, `DATABASE_URL_DIRECT_AI`, `DATABASE_URL_MEDIA`, `DATABASE_URL_NOTIFICATION` |
| `geosound-jwt` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STATS_ACTOR_SALT` |
| `geosound-infra` | `RABBITMQ_URL`, `REDIS_URL`, `INTERNAL_SERVICE_TOKEN` |
| `geosound-ai` | `GEMINI_API_KEY`, `GROQ_API_KEY`, `LANGSMITH_API_KEY` |
| `geosound-smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| `geosound-storage` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

How secrets get into the cluster, in order of preference:

1. **Sealed Secrets**: the controller runs in the cluster; `kubeseal` encrypts each secret with the cluster's public key; the encrypted file is safe to commit under `deploy/envs/<env>/sealed/`. Argo CD deploys it like any other manifest.
2. Fallback: an admin creates them once with `kubectl create secret generic ... --from-env-file` from a file that lives only on their machine.

Plain secrets and `.env` files are never committed. GitHub Actions never holds application secrets; it only pushes images and commits tags.

### 8.5 Database migrations

`templates/migrate-job.yaml` renders one Job per service with `migrate: true`, using the same image and running `npx prisma migrate deploy` with the direct (non-pooler) URL (`DATABASE_URL_DIRECT_<SVC>`, the same command as the compose `migrate` service of task 0.6). The `media` and `ai` images have no Prisma CLI, so their Jobs use a small migrate image built by CI from the tour image plus `scripts/db/migrate.sh` and every `prisma` folder (the layout of the compose `migrate` service). Annotations `argocd.argoproj.io/hook: PreSync` and `hook-delete-policy: BeforeHookCreation` make Argo CD run it before the new pods start. A failed migration stops the sync, so the old version keeps running.

Migrations must be backward compatible with the running version (expand, deploy, then contract in a later release), because old and new pods run side by side during a rolling update.

## 9. Phase 3: continuous delivery with Argo CD

### 9.1 Flow

```text
merge to staging
  → images.yml builds sha-abc1234
  → promote job: yq sets every changed service tag in deploy/envs/staging/values.yaml,
    commits "chore: deploy sha-abc1234 to staging" with a bot token
  → Argo CD (auto-sync, self-heal, prune) applies the chart
  → PreSync: migrate Jobs
  → rolling update, readiness gates traffic
  → PostSync: smoke test Job (curl /readyz on each service, GET /api/tours, login with a test account
    that exists only in the staging database)
  → result posted to the Discord channel (Argo CD Notifications)

tag v1.4.0 on main
  → images.yml tags the same images v1.4.0 (no rebuild: retag sha-abc1234)
  → promote job opens a PR that changes deploy/envs/prod/values.yaml
  → a reviewer approves and merges (GitHub environment "production" with required reviewers)
  → an admin clicks Sync in Argo CD for geosound-prod (manual sync)
```

The promote job uses a fine-grained token that can only write `deploy/` contents, stored as the secret `DEPLOY_BOT_TOKEN`. To avoid a loop, `images.yml` ignores commits that only change `deploy/**`.

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
