#!/bin/sh
# Static check of the Helm chart (deployment plan task 2.1, issue #369). Used by CI (job `chart`)
# and locally. Needs `helm` and `kubeconform` on PATH.
#
#   sh scripts/deploy/check-chart.sh [kubernetes version, default 1.31.0]
#
# For every environment under deploy/envs/: helm lint, helm template, kubeconform -strict.
# Also checks that a release without global.image.tag fails to render.
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
  --set services.tour.allowFrom=null --set networkPolicy.monitoringNamespace= | grep -q "^  name: tour$"; then
  echo "[chart] FAIL: a NetworkPolicy was rendered for tour without any allowed source"
  fail=1
fi

echo "[chart] one-pod apps get no PodDisruptionBudget (it would block node drains)"
n=$(helm template geosound "$CHART" -f deploy/envs/staging/values.yaml | grep -c "^kind: PodDisruptionBudget" || true)
if [ "$n" != "0" ]; then
  echo "[chart] FAIL: $n PodDisruptionBudget(s) in staging, where every app runs one pod"
  fail=1
fi

exit "$fail"
