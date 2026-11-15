# Kubernetes cluster runbook (k3s)

How to set up a GeoSound cluster from nothing and put the stack on it (deployment plan task 2.6, issue #374, `docs/02-design/deployment-plan.md` section 8.1). Part A is a real VM with a public host name. Part B is the same stack on a laptop, for trying the chart. Day-to-day work (upgrade, rollback, secrets, adding a service) is in [`deploy/README.md`](../../deploy/README.md).

Versions checked with this runbook (2026-11-15): k3s v1.31.4 (Traefik 2.11), cert-manager v1.21.3, Sealed Secrets v0.41.2, Helm 3.

Argo CD (step 4 of plan 8.1) is not part of this runbook: it comes with phase 3. Until then, deploy with `helm upgrade --install`.

## A. A VM with a public host

### A1. The VM

1. Ubuntu 24.04, 8 GB RAM, 4 vCPU (staging, production and monitoring together, plan section 5).
2. Open ports 22, 80 and 443 only, in the provider's firewall and on the VM:

   ```sh
   sudo ufw default deny incoming
   sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   sudo ufw enable
   ```

   The Kubernetes API (6443) stays closed: use it through SSH (`ssh -L 6443:127.0.0.1:6443 <vm>`).
3. SSH with keys only: in `/etc/ssh/sshd_config` set `PasswordAuthentication no` and `PermitRootLogin no`, then `sudo systemctl restart ssh`.
4. DNS: an `A` record for each host (`staging.<domain>`, `<domain>`) to the VM's public IP. Port 80 must stay open: Let's Encrypt checks the HTTP-01 challenge on it, at issue and at every renewal.

### A2. k3s

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.31.4+k3s1 sh -
sudo cat /etc/rancher/k3s/k3s.yaml   # kubeconfig: copy it to your machine, keep server 127.0.0.1 with the SSH tunnel
```

Keep the bundled Traefik (the chart's Ingress class `traefik`, in `kube-system`) and the `local-path` storage class (the RabbitMQ and Redis volumes). k3s enforces NetworkPolicies out of the box.

### A3. cert-manager and the issuers

```sh
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --version v1.21.3 --set crds.enabled=true --wait
kubectl apply -f deploy/cluster/cluster-issuers.yaml
kubectl get clusterissuer   # letsencrypt-staging and letsencrypt-prod, READY True
```

### A4. Sealed Secrets

```sh
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.41.2/controller.yaml
kubectl -n kube-system rollout status deploy/sealed-secrets-controller
```

(The plan's step 5, the RabbitMQ Cluster Operator, is dropped: the chart runs RabbitMQ as a StatefulSet, task 2.3.)

Back up the controller's key once; without it, no sealed file in the repo can be decrypted on a new cluster:

```sh
kubectl -n kube-system get secret -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml > sealed-secrets-key.backup.yaml
```

Keep that file in a password manager, never in the repo.

### A5. Namespaces, images, secrets

```sh
kubectl apply -f deploy/cluster/namespaces.yaml   # geosound-staging, geosound-prod, monitoring
```

Images: the GHCR packages `geosound-*` must be public, or create a read-only pull secret in each namespace and list it in `global.imagePullSecrets`:

```sh
kubectl -n geosound-staging create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<read:packages token>
```

Secrets (task 2.5): fetch the certificate, seal an env file that lives outside the repo, apply.

```sh
kubeseal --controller-namespace kube-system --fetch-cert > deploy/envs/staging/sealed-secrets.pem
sh scripts/deploy/seal-secrets.sh staging /path/to/staging.env
kubectl apply -f deploy/envs/staging/sealed/
kubectl -n geosound-staging get secret   # geosound-db, -jwt, -infra, -broker, -ai, -storage (-smtp)
```

The `.pem` and the `sealed/*.yaml` files are safe to commit. The env file is not.

### A6. Install

Check `deploy/envs/staging/values.yaml`: `global.image.tag` (a tag CI published for all 9 images), `ingress.host`, `services.media.env.MEDIA_PUBLIC_BASE_URL`. Try the certificate with the Let's Encrypt staging issuer first: its rate limits forgive a wrong DNS record.

```sh
helm upgrade --install geosound deploy/helm/geosound -n geosound-staging \
  -f deploy/envs/staging/values.yaml --set ingress.clusterIssuer=letsencrypt-staging --wait --timeout 10m
kubectl -n geosound-staging get certificate   # geosound-tls READY True after a minute
```

Then run the same command without `--set` (the env file names `letsencrypt-prod`) and delete the old secret so cert-manager issues a trusted certificate: `kubectl -n geosound-staging delete secret geosound-tls`.

On the first install the migrate Job runs before anything else. On Supabase it only works once the schemas are baselined (task 0.6, done by the user, never by a script).

### A7. Check

```sh
curl -sI http://staging.<domain>/          # 301 to https
sh scripts/deploy/smoke-staging.sh https://staging.<domain> geosound-staging
```

The smoke check reads the OTP from the auth log, so it only works while `geosound-smtp` is not set (staging). Production: open the site, sign in with a real account, add a place.

Production is the same with `prod` in every name. Its values require `geosound-smtp` and run two gateway and tour pods with an autoscaler.

## B. A laptop cluster (k3s in Docker)

For trying the chart without a VM. It needs Docker Desktop with about 6 GB of memory. There is no public host: plain HTTP, no certificate, a local Postgres and an AI stub instead of Supabase and the LLM providers.

### B1. Start k3s

```sh
mkdir -p ~/geosound-k3s
docker run -d --name geosound-k3s --privileged \
  -p 127.0.0.1:16443:6443 -p 127.0.0.1:18080:80 \
  -e K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml -e K3S_KUBECONFIG_MODE=666 \
  -v ~/geosound-k3s:/output rancher/k3s:v1.31.4-k3s1 server --tls-san 127.0.0.1
sed -i 's/127.0.0.1:6443/127.0.0.1:16443/' ~/geosound-k3s/kubeconfig.yaml
export KUBECONFIG=~/geosound-k3s/kubeconfig.yaml
kubectl get nodes
```

Traefik answers on `http://127.0.0.1:18080`.

### B2. Controllers and namespaces

Steps A4 and A5 (namespaces) as they are. cert-manager (A3) is only needed to try the TLS settings.

If CI has not published the migrate image for the tag yet, build it and load it into k3s:

```sh
docker build -f deploy/migrate/Dockerfile -t ghcr.io/tran-gia-phuc/geosound-migrate:<tag> .
docker save ghcr.io/tran-gia-phuc/geosound-migrate:<tag> | docker exec -i geosound-k3s ctr -n k8s.io images import -
```

### B3. Secrets and stand-ins

`deploy/local/local.env.example` holds dummy values that match the stand-ins. Seal them into a folder outside the repo (they are tied to this laptop's controller):

```sh
kubeseal --controller-namespace kube-system --fetch-cert > ~/geosound-k3s/cert.pem
SEALED_CERT=~/geosound-k3s/cert.pem SEALED_DIR=~/geosound-k3s/sealed \
  sh scripts/deploy/seal-secrets.sh staging deploy/local/local.env.example
kubectl apply -f ~/geosound-k3s/sealed/
kubectl apply -f deploy/local/postgres.yaml -f deploy/local/ai-stub.yaml
kubectl -n geosound-staging create configmap ai-stub --from-file=tests/e2e/ai-stub/server.mjs \
  --dry-run=client -o yaml | kubectl apply -f -
```

The AI stub approves every place unless its text contains `E2E_REJECT`. The real `ai` pod still runs (chatbot and translation), without LLM keys.

### B4. Install and check

```sh
helm upgrade --install geosound deploy/helm/geosound -n geosound-staging \
  -f deploy/envs/staging/values.yaml -f deploy/local/values.yaml --wait --timeout 10m
SMOKE_REJECT=1 KUBECTL="kubectl --kubeconfig $KUBECONFIG" \
  sh scripts/deploy/smoke-staging.sh http://127.0.0.1:18080 geosound-staging
```

Expected: every step `[smoke] ...: <code>`, the first place `approved`, the `E2E_REJECT` place `rejected`, then `[smoke] OK`.

To try the TLS settings, add `--set ingress.host=geosound.localtest --set ingress.clusterIssuer=letsencrypt-staging`: plain HTTP then answers 301, and cert-manager creates the Certificate `geosound-tls`, which stays not ready (Let's Encrypt cannot reach a laptop).

Clean up: `docker rm -f geosound-k3s`.

## Troubleshooting

**`ai` is not ready for a few minutes after a fresh install** (`/readyz` answers 503 with `"rabbitmq":"down"`). Expected: on a new cluster the RabbitMQ StatefulSet takes a while (volume, first boot), and the chatbot indexer waits for it in the background (since #375: retry after 3 s, doubling, at most 30 s apart, no limit). The logs show `RabbitMQ not ready ... retry <n>`, then `RabbitMQ connected after <n> attempts`, and the pod turns ready by itself. Nothing to restart. If it never connects, check `kubectl -n <ns> get pods rabbitmq-0` and the `geosound-infra` / `geosound-broker` secrets.

**A release stuck in `pending-install` or `pending-upgrade`** (after the laptop slept, or a lost connection during `--wait`): `helm history geosound -n <ns>` shows it. If no helm command is still running, delete the release secret of that revision (`kubectl -n <ns> delete secret sh.helm.release.v1.geosound.v<N>`) and run the upgrade again; Helm takes over the existing objects.

**A changed secret has no effect.** Pods read secrets at start: `kubectl -n <ns> rollout restart deploy` (or only the apps that load it).

**A SealedSecret does not create its Secret.** `kubectl -n <ns> describe sealedsecret <name>`: "already exists and is not managed" means a hand-made Secret of that name; delete it. "no key could decrypt" means it was sealed for another cluster: fetch the certificate again and reseal.

**The certificate stays not ready.** `kubectl -n <ns> describe certificate geosound-tls`, then the `Challenge` objects. Usual causes: the DNS record does not point at the VM yet, port 80 is closed, or the chart's NetworkPolicy `acme-http01-solver` is missing (it is rendered whenever `ingress.clusterIssuer` is set).

**The migrate Job failed.** `kubectl -n <ns> logs job/geosound-migrate`. Nothing else changed; fix and upgrade again.
