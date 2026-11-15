# deploy/

Everything that puts GeoSound on Kubernetes (deployment plan phase 2, `docs/02-design/deployment-plan.md` section 8). Setting up a cluster from nothing (VM, k3s, cert-manager, Sealed Secrets, DNS) is in the runbook [`docs/04-guides/k3s-cluster.md`](../docs/04-guides/k3s-cluster.md). This file covers day-to-day work on a cluster that already runs.

## Layout

```text
deploy/
  helm/geosound/        the chart: 8 apps, RabbitMQ, Redis, migrate Job, Ingress, HPA, PDB,
                        network policies (defaults in values.yaml)
  envs/<env>/           values.yaml per environment (image tag, host, replicas, limits);
                        later sealed-secrets.pem and sealed/*.yaml (task 2.5)
  cluster/              one-time cluster objects: namespaces, Let's Encrypt ClusterIssuers
  local/                laptop values and stand-ins (Postgres, AI stub): never on a real cluster;
                        values-supabase.yaml = laptop stack on the team Supabase (phase 3)
  argocd/               Argo CD on the laptop cluster: chart values and the Applications (phase 3);
                        apps/monitoring.yaml = the monitoring stack (phase 4)
  monitoring/           monitoring stack (phase 4): values/ for the kube-prometheus-stack, Loki and
                        Alloy charts; dashboards/ and alerts/ (kustomize, Application monitoring-config)
  migrate/              the geosound-migrate image (Prisma CLI and every schema)
```

Scripts: `scripts/deploy/check-chart.sh` (lint, render and validate the chart, run by CI), `scripts/deploy/seal-secrets.sh` (seal an env file), `scripts/deploy/smoke-staging.sh` (end-to-end check of a running environment).

## Install or upgrade

One release per namespace, named `geosound`. The image tag lives in `deploy/envs/<env>/values.yaml` (`global.image.tag`, one tag for all 8 apps and the migrate image).

```sh
helm upgrade --install geosound deploy/helm/geosound -n geosound-staging \
  -f deploy/envs/staging/values.yaml --wait --timeout 10m
```

What happens:

1. The `geosound-migrate` Job runs first (pre-install / pre-upgrade hook): `prisma migrate deploy` for every schema in `migrate.services`. If it fails, nothing else changes and the old version keeps running; read it with `kubectl -n geosound-staging logs job/geosound-migrate`.
2. The Deployments roll one pod at a time. A pod gets traffic only once `/readyz` answers 200.
3. `--wait` returns when every pod is Ready, or fails after the timeout.

Before a change to the chart, run `sh scripts/deploy/check-chart.sh` (needs `helm` and `kubeconform`; CI runs the same script in the job `chart`).

Phase 3 replaces the manual command with Argo CD, which applies the same chart and values from Git. On the laptop cluster this is done (runbook section B5, `deploy/argocd/`): `geosound-staging` follows branch `staging`, so deploying there means merging into `staging`, and `helm upgrade` / `helm uninstall geosound` must never run on that namespace again. CI job `promote` writes the tag of every `staging` build into `envs/staging/values.yaml` on that branch (task 3.2), and the read-only PostSync Job `geosound-smoke` checks each sync (task 3.3, `smoke.enabled`, on in staging).

## Roll back

```sh
helm history geosound -n geosound-staging
helm rollback geosound <revision> -n geosound-staging --wait
```

A rollback restores the manifests and the image tag, **not the database**: migrations are never undone, and the migrate hook does not run on rollback. That is fine as long as every migration is backward compatible with the previous release (add columns and tables, never drop or rename in the same release). If the database must go back, restore it from a Supabase backup first.

After a rollback, set `global.image.tag` in the env file back to the rolled-back tag, or the next upgrade brings the new version back.

## Secrets

Secrets never go into a values file. They are created by Sealed Secrets (plan section 8.4, task 2.5):

```sh
# once per cluster: the controller's public certificate (safe to commit)
kubeseal --controller-namespace kube-system --fetch-cert > deploy/envs/staging/sealed-secrets.pem
# every time the values change: the env file stays outside the repo (or .env.staging, git-ignored)
sh scripts/deploy/seal-secrets.sh staging /path/to/staging.env
kubectl apply -f deploy/envs/staging/sealed/
# pods read secrets at start: restart the apps that load the changed secret
kubectl -n geosound-staging rollout restart deploy
```

The sealed files are bound to the cluster key and to the namespace: sealing for a new cluster means fetching its certificate again. A Secret made by hand with `kubectl create secret` is not taken over by the controller: delete it first.

## Check an environment

```sh
sh scripts/deploy/smoke-staging.sh https://staging.geosound.example.com geosound-staging
```

It plays a new contributor through the Ingress: client page, public tours, register, OTP (read from the auth log, so only where `geosound-smtp` is not set), login, a new tour and a place, then waits until moderation approves the place. It leaves one test account and one draft tour behind. `SMOKE_REJECT=1` also checks a rejection, with the AI stub of `deploy/local/` only.

## Monitoring

On the laptop cluster, Argo CD installs Prometheus, Alertmanager, Grafana, Loki and Alloy into the namespace `monitoring` (phase 4, task 4.1): `kubectl apply -f deploy/argocd/apps/monitoring.yaml`. The charts are pinned in that file and their values live in `deploy/monitoring/values/`, so a change is deployed by merging into `staging`; never `helm upgrade` or `helm uninstall` these releases. Dashboards (`deploy/monitoring/dashboards/`) and alert rules (`deploy/monitoring/alerts/`) are a kustomize directory synced by the Application `monitoring-config`. The Grafana admin Secret, the port-forwards, the log labels and the resource budget are in the runbook, section [B6](../docs/04-guides/k3s-cluster.md#b6-monitoring). `sh scripts/deploy/check-chart.sh` also validates these files.

## Alerts

The rules are in `deploy/monitoring/alerts/geosound-rules.yaml` (deployment plan section 10.4, task 4.7). Each alert links to its section below through `runbook_url`. Check a rule change with `promtool check rules` (image `prom/prometheus`, pinned) on the `spec` of that file.

**Route.** Alertmanager sends every alert with `team="geosound"` (all the rules below) and every `critical` alert of the chart's default rules to the Discord channel `#geosound-alerts`, plus a "resolved" message when it ends; everything else, `Watchdog` and `InfoInhibitor` go nowhere. Alerts are grouped by `alertname` and `namespace` and repeated every 4 h while they fire. The webhook URL is the Secret `alertmanager-discord` (key `url`) in the namespace `monitoring`, made by hand and never in Git; Alertmanager does not start without it. Replace it from a file, never on the command line:

```sh
kubectl -n monitoring create secret generic alertmanager-discord --from-file=url=<file> \
  --dry-run=client -o yaml | kubectl apply -f -
```

**Silence** an alert (planned work, a noisy night on staging): `kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 4470:9093 --address 127.0.0.1`, open `http://127.0.0.1:4470`, "New Silence" with the matchers `alertname="<name>"` and `namespace="<ns>"`, a duration and a comment. Status shows the loaded config and receivers. The PromQL below runs in Prometheus (`127.0.0.1:4469`), the LogQL in Grafana, Explore, Loki (`127.0.0.1:4468`).

### PodCrashLooping

A container of a GeoSound pod restarted more than 3 times in 15 minutes (critical).

- `kubectl -n <ns> get pods`, `kubectl -n <ns> describe pod <pod>` (last state, exit code, `OOMKilled`, failing probe).
- `kubectl -n <ns> logs <pod> -c <container> --previous`, or `{namespace="<ns>", pod="<pod>"} |= "error"` in Loki.
- Fixes: a missing Secret key (the app exits at start), a database or RabbitMQ that is not reachable, `OOMKilled` (raise `resources.limits.memory` of the app in the env values), a bad image tag (section "Roll back").

### HighErrorRate

More than 5% of the HTTP requests of one service answered 5xx for 5 minutes, with at least 5 errors in the window (critical).

- Which routes: `sum by (route, status) (rate(http_requests_total{namespace="<ns>", service="<svc>", status=~"5.."}[5m]))`.
- Logs: `{namespace="<ns>", service="<svc>", level="error"}`; follow one request with `| reqId="<id>"`.
- A gateway alert alone usually means an app behind it is down (`502`, `504`): see TargetDown and that app's own error rate.
- Fixes: database or Supabase pooler down, a caller blocked by the network policy (`allowFrom`), a bad release (roll back).

### HighLatency

The p95 of the HTTP request duration of one service is above 1 s for 10 minutes (warning). The `ai` service and the chat stream (`/api/chat` on the gateway) are left out: they are slow by design.

- Slow routes: `histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket{namespace="<ns>", service="<svc>"}[5m])))`.
- CPU throttling or memory pressure: `kubectl -n <ns> top pods`, and the Grafana dashboard of the service.
- Fixes: a slow database query, a CPU limit too low, more replicas (`hpa` of the app). Large uploads under `/api/media` can be slow on a bad network.

### QueueBacklog

More than 100 RabbitMQ messages have been ready, not taken by a consumer, for 10 minutes (warning). The metric is the sum over all queues.

- Which queue: `kubectl -n <ns> exec rabbitmq-0 -- rabbitmqctl list_queues name messages_ready consumers`.
- A queue with `0` consumers: the consuming app is down or lost its connection; check its pod and `{namespace="<ns>", service="<svc>"} |= "rabbit"`.
- Fixes: restart the consumer (`kubectl -n <ns> rollout restart deploy/<svc>`) once it no longer crashes; a consumer that rejects every message shows in `events_consumed_total{result="nack"}`.

### ModerationStuck

More than 20 moderation cases have been in `ai_failed` for 15 minutes (warning): calls to the AI service keep failing, the retry sweeper cannot clear them, and places and tours wait for review.

- Why: `sum by (reason) (rate(moderation_ai_failed_total{namespace="<ns>"}[15m]))` (`timeout`, `503`, `401`, `other`).
- `401`: `INTERNAL_SERVICE_TOKEN` of `geosound-infra` does not match between moderation and ai. `503` or `timeout`: see LLMProviderDown and `{namespace="<ns>", service="ai", level="error"}`.
- Fixes: fix the token or the provider key and restart the apps that load it; the sweeper retries the cases by itself, nothing to replay by hand.

### LLMProviderDown

More than half of the AI service's calls to one LLM provider (`gemini` or `groq`) failed with 429, 5xx, timeout or error over 10 minutes (warning). Content blocked by the provider is not counted.

- Outcomes: `sum by (provider, outcome) (rate(llm_requests_total{namespace="<ns>"}[10m]))`; fallbacks: `rate(llm_fallback_total[10m])`.
- `429`: the Gemini free tier (5 requests per minute) is used up; it recovers by itself. `5xx` or `timeout`: provider outage, check its status page.
- `error`: often a bad or expired API key (Secret `geosound-ai`); logs `{namespace="<ns>", service="ai", level="error"}`.

### TargetDown

Prometheus has had no successful scrape of a GeoSound job for 4 minutes (critical): all its pods are gone, not ready, or `/metrics` fails. It also fires when a Deployment is scaled to 0.

- `kubectl -n <ns> get deploy/<job> endpoints/<job>`, `kubectl -n <ns> get pods -l app.kubernetes.io/name=<job>`, `up{namespace="<ns>", job="<job>"}`, Prometheus Status, Targets.
- `0/0` replicas: someone scaled it down, and Argo CD auto-sync is paused or self-heal is off (`kubectl -n argocd get app geosound-staging -o jsonpath='{.spec.syncPolicy.automated}'`).
- Pods not ready: see PodCrashLooping. Pods ready but the scrape fails: the network policy must let the namespace `monitoring` reach the port (`networkPolicy.monitoringNamespace`).
- An app removed on purpose keeps firing for up to 1 h (the rule looks back one hour): silence it.

### NodeMemoryHigh

A node has used more than 85% of its memory for 10 minutes (warning).

- `kubectl top nodes`, `kubectl top pods -A --sort-by=memory`.
- Fixes: lower limits or replicas on staging, stop what is not needed on the laptop, or give the VM more memory (laptop sizing: decision P4-3).

### DiskAlmostFull

A node disk has had less than 15% free space for 10 minutes (critical).

- Which mount: `node_filesystem_avail_bytes{job="node-exporter", instance="<node>"} / node_filesystem_size_bytes{job="node-exporter", instance="<node>"}`.
- Big users: unused images (`k3s crictl rmi --prune` on the node), volumes (`kubectl get pvc -A`; Prometheus keeps 2 days, at most 2 GB), container logs.
- Fixes: prune images, shorten retention, or grow the disk.

## Add a service

1. `deploy/helm/geosound/values.yaml`, under `services`: an entry named after the app with `port`, `allowFrom` (the apps that call it over HTTP; without it the default deny blocks every caller), `database: { key: DATABASE_URL_<SVC> }` if it has a schema, and `secrets` (only the ones its code reads). Add `public: true` only if Traefik must reach it.
2. If it calls another app, add its name to that app's `allowFrom`. If it loads `geosound-infra`, the RabbitMQ and Redis policies let it in by themselves.
3. Add its URL to `config` if other apps call it (the Service is named after the app, e.g. `http://<name>:<port>`).
4. `.github/workflows/images.yml`: a matrix entry so CI publishes `geosound-<name>` with every tag (one tag deploys the whole stack, so a missing image breaks the release).
5. If it has a Prisma schema: add it to `migrate.services`, a `COPY services/<name>/prisma /migrations/<name>` line to `deploy/migrate/Dockerfile` (the allow list already takes every `services/*/prisma`), its folder to the migrate matrix `paths`, and its database keys to `scripts/deploy/seal-secrets.sh`.
6. Run `sh scripts/deploy/check-chart.sh`.

## Troubleshooting

See the runbook, section "Troubleshooting": AI not ready after a fresh install, a release stuck in `pending-*`, a certificate that stays not ready.
