#!/bin/sh
# Static check of the Helm chart (deployment plan task 2.1, issue #369). Used by CI (job `chart`)
# and locally. Needs `helm`, `kubeconform` and `kubectl` (or `kustomize`) on PATH.
#
#   sh scripts/deploy/check-chart.sh [kubernetes version, default 1.31.0]
#
# For every environment under deploy/envs/: helm lint, helm template, kubeconform -strict.
# Also checks that a release without global.image.tag fails to render, and the monitoring files
# (Argo CD Applications, chart values, the kustomize directory deploy/monitoring).
set -eu

CHART=deploy/helm/geosound
K8S_VERSION=${1:-1.31.0}
# Kubernetes schemas, then the community catalog for CRDs (Traefik Middleware; ServiceMonitor later).
CRD_SCHEMAS='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

fail=0
for values in deploy/envs/*/values.yaml; do
  env=$(basename "$(dirname "$values")")
  echo "[chart] $env: lint"
  helm lint --strict "$CHART" -f "$values" || { fail=1; continue; }
  echo "[chart] $env: template + kubeconform (Kubernetes $K8S_VERSION)"
  helm template geosound "$CHART" -n "geosound-$env" -f "$values" > "$OUT/$env.yaml" || { fail=1; continue; }
  kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" \
    -schema-location default -schema-location "$CRD_SCHEMAS" "$OUT/$env.yaml" || fail=1
done

echo "[chart] a release without an image tag must not render"
if helm template geosound "$CHART" > /dev/null 2>&1; then
  echo "[chart] FAIL: rendered without global.image.tag"
  fail=1
fi

echo "[chart] rabbitmq.enabled=false and redis.enabled=false render no broker (external broker)"
n=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml \
  --set rabbitmq.enabled=false --set redis.enabled=false | grep -c '^kind: StatefulSet' || true)
if [ "$n" != "0" ]; then
  echo "[chart] FAIL: $n StatefulSet(s) rendered with the broker switched off"
  fail=1
fi

echo "[chart] an app with no caller and no scraping gets no NetworkPolicy (default deny), never an allow-all rule"
if helm template geosound "$CHART" -f deploy/envs/staging/values.yaml -s templates/networkpolicy.yaml \
  --set services.tour.allowFrom=null --set networkPolicy.monitoringNamespace= --set smoke.enabled=false |
  grep -q "^  name: tour$"; then
  echo "[chart] FAIL: a NetworkPolicy was rendered for tour without any allowed source"
  fail=1
fi

echo "[chart] smoke test (task 3.3): one PostSync Job that checks every app, and every app lets it in"
smoke=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml -s templates/smoke-job.yaml)
apps=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml -s templates/deployment.yaml |
  grep -c "^kind: Deployment" || true)
checks=$(echo "$smoke" | grep -c "^ *ready [a-z]* http://" || true)
if ! echo "$smoke" | grep -q "argocd.argoproj.io/hook: PostSync" || [ "$checks" != "$apps" ]; then
  echo "[chart] FAIL: the smoke Job is missing, not PostSync, or checks $checks apps instead of $apps"
  fail=1
fi
allowed=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml -s templates/networkpolicy.yaml |
  grep -c "app.kubernetes.io/name: smoke" || true)
if [ "$allowed" != "$apps" ]; then
  echo "[chart] FAIL: $allowed of $apps app NetworkPolicies let the smoke Job in"
  fail=1
fi
if helm template geosound "$CHART" -f deploy/envs/prod/values.yaml | grep -q "name: geosound-smoke"; then
  echo "[chart] FAIL: the smoke Job is rendered where smoke.enabled is off"
  fail=1
fi

echo "[chart] one-pod apps get no PodDisruptionBudget (it would block node drains)"
n=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml | grep -c "^kind: PodDisruptionBudget" || true)
if [ "$n" != "0" ]; then
  echo "[chart] FAIL: $n PodDisruptionBudget(s) in staging, where every app runs one pod"
  fail=1
fi

# Monitoring stack (phase 4, task 4.1). The charts themselves are rendered by Argo CD from their Helm
# repositories; CI only checks what lives in this repository.
echo "[monitoring] Argo CD Applications match the Application schema"
kubeconform -strict -summary -schema-location "$CRD_SCHEMAS" deploy/argocd/apps/*.yaml || fail=1

echo "[monitoring] chart values files are valid YAML"
# A chart with no templates: helm only parses the values file (catches YAML syntax errors).
mkdir -p "$OUT/probe"
printf 'apiVersion: v2\nname: probe\nversion: 0.0.0\n' > "$OUT/probe/Chart.yaml"
for values in deploy/monitoring/values/*.yaml; do
  helm template probe "$OUT/probe" -f "$values" > /dev/null || {
    echo "[monitoring] FAIL: $values does not parse"
    fail=1
  }
done

echo "[monitoring] deploy/monitoring builds with kustomize + kubeconform (Kubernetes $K8S_VERSION)"
# kubectl is preinstalled on the GitHub ubuntu runners; a standalone kustomize works too.
if command -v kubectl > /dev/null 2>&1; then
  kubectl kustomize deploy/monitoring > "$OUT/monitoring.yaml" || fail=1
elif command -v kustomize > /dev/null 2>&1; then
  kustomize build deploy/monitoring > "$OUT/monitoring.yaml" || fail=1
else
  echo "[monitoring] FAIL: needs kubectl or kustomize on PATH"
  fail=1
fi
if [ -f "$OUT/monitoring.yaml" ]; then
  kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" \
    -schema-location default -schema-location "$CRD_SCHEMAS" "$OUT/monitoring.yaml" || fail=1
fi

exit "$fail"
