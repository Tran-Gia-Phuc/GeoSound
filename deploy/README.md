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
  argocd/               Argo CD on the laptop cluster: chart values and the Application (phase 3)
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

## Add a service

1. `deploy/helm/geosound/values.yaml`, under `services`: an entry named after the app with `port`, `allowFrom` (the apps that call it over HTTP; without it the default deny blocks every caller), `database: { key: DATABASE_URL_<SVC> }` if it has a schema, and `secrets` (only the ones its code reads). Add `public: true` only if Traefik must reach it.
2. If it calls another app, add its name to that app's `allowFrom`. If it loads `geosound-infra`, the RabbitMQ and Redis policies let it in by themselves.
3. Add its URL to `config` if other apps call it (the Service is named after the app, e.g. `http://<name>:<port>`).
4. `.github/workflows/images.yml`: a matrix entry so CI publishes `geosound-<name>` with every tag (one tag deploys the whole stack, so a missing image breaks the release).
5. If it has a Prisma schema: add it to `migrate.services`, a `COPY services/<name>/prisma /migrations/<name>` line to `deploy/migrate/Dockerfile` (the allow list already takes every `services/*/prisma`), its folder to the migrate matrix `paths`, and its database keys to `scripts/deploy/seal-secrets.sh`.
6. Run `sh scripts/deploy/check-chart.sh`.

## Troubleshooting

See the runbook, section "Troubleshooting": AI not ready after a fresh install, a release stuck in `pending-*`, a certificate that stays not ready.
