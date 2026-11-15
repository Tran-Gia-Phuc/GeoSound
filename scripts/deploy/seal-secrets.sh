#!/bin/sh
# Seal the GeoSound secrets of one environment (deployment plan task 2.5, issue #373).
#
#   sh scripts/deploy/seal-secrets.sh <env> <env-file>
#
# Reads KEY=VALUE lines from <env-file>, a file that lives only on the admin's machine (keep it
# outside the repo, or name it .env.<env>: git ignores .env.*). Splits the keys into the secrets of
# plan section 8.4 and writes one SealedSecret per secret to deploy/envs/<env>/sealed/<name>.yaml,
# encrypted for the namespace geosound-<env> (strict scope: name and namespace are bound). Values
# are taken literally (no $VAR expansion), surrounding quotes removed. They only travel through a
# pipe into kubeseal: no plain value is written to disk or printed, only key names.
#
# Needs kubeseal (and base64, grep, cut, tr). It encrypts with SEALED_CERT, by default
# deploy/envs/<env>/sealed-secrets.pem: the controller's public certificate, safe to commit
# (`kubeseal --fetch-cert > deploy/envs/<env>/sealed-secrets.pem`). Without that file kubeseal
# asks the controller of the current kubectl context. SEALED_DIR overrides the output directory.
#
# In-cluster broker (task 2.3): give RABBITMQ_DEFAULT_USER and RABBITMQ_DEFAULT_PASS (and
# REDIS_PASSWORD if wanted). Without RABBITMQ_URL / REDIS_URL in the file, the app URLs are built
# from them (amqp://<user>:<pass>@rabbitmq:5672, redis://[:<pass>@]redis:6379), so the broker and
# the apps can never disagree.
set -eu

[ $# -eq 2 ] || { echo "usage: $0 <env> <env-file>" >&2; exit 2; }
ENV=$1
FILE=$2
[ -f "$FILE" ] || { echo "[seal] $FILE: no such file" >&2; exit 2; }
case $ENV in *[!a-z0-9-]*|'') echo "[seal] env must be lowercase letters, digits, -" >&2; exit 2 ;; esac
NS=geosound-$ENV
OUT=${SEALED_DIR:-deploy/envs/$ENV/sealed}
CERT=${SEALED_CERT:-deploy/envs/$ENV/sealed-secrets.pem}
CR=$(printf '\r')
umask 077

# Keys of every secret (plan section 8.4, plus geosound-broker of task 2.3).
SECRETS="geosound-db geosound-jwt geosound-infra geosound-ai geosound-smtp geosound-storage geosound-broker"
keys_of() {
  case $1 in
    geosound-db)
      for s in AUTH TOUR MODERATION AI MEDIA NOTIFICATION; do
        echo "DATABASE_URL_$s DATABASE_URL_DIRECT_$s" # direct URLs: migrations (task 2.4), AI chat memory
      done ;;
    geosound-jwt) echo JWT_ACCESS_SECRET JWT_REFRESH_SECRET STATS_ACTOR_SALT ;;
    geosound-infra) echo RABBITMQ_URL REDIS_URL INTERNAL_SERVICE_TOKEN ;;
    geosound-ai) echo GEMINI_API_KEY GROQ_API_KEY LANGSMITH_API_KEY ;;
    geosound-smtp) echo SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM ;;
    geosound-storage) echo SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_STORAGE_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY ;;
    geosound-broker) echo RABBITMQ_DEFAULT_USER RABBITMQ_DEFAULT_PASS REDIS_PASSWORD ;;
  esac
}
# Without these the apps do not start.
REQUIRED="DATABASE_URL_AUTH DATABASE_URL_TOUR DATABASE_URL_MODERATION DATABASE_URL_AI
  DATABASE_URL_MEDIA DATABASE_URL_NOTIFICATION JWT_ACCESS_SECRET JWT_REFRESH_SECRET
  RABBITMQ_URL REDIS_URL INTERNAL_SERVICE_TOKEN"

in_file() { grep -q "^[[:space:]]*$1=" "$FILE"; }
from_file() {
  v=$(grep "^[[:space:]]*$1=" "$FILE" | tail -n 1 | cut -d= -f2-)
  v=${v%"$CR"} # a file saved on Windows
  case $v in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}
# A value that goes into a URL unencoded.
url_safe() {
  case $(from_file "$1") in
    *[!A-Za-z0-9._~-]*|'')
      echo "[seal] $1 must use only letters, digits and . _ ~ - to build the URL; or set the URL yourself" >&2
      exit 1 ;;
  esac
}
# Value of a key: the file first, then the URLs built for the in-cluster broker.
get() {
  if in_file "$1"; then from_file "$1"; return 0; fi
  case $1 in
    RABBITMQ_URL)
      if in_file RABBITMQ_DEFAULT_USER && in_file RABBITMQ_DEFAULT_PASS; then
        printf 'amqp://%s:%s@rabbitmq:5672' "$(from_file RABBITMQ_DEFAULT_USER)" "$(from_file RABBITMQ_DEFAULT_PASS)"
      fi ;;
    REDIS_URL)
      if [ -n "$(get REDIS_PASSWORD)" ]; then
        printf 'redis://:%s@redis:6379' "$(from_file REDIS_PASSWORD)"
      else
        printf 'redis://redis:6379'
      fi ;;
  esac
}
# A key goes into its secret when the file has it (even empty) or when it was built.
present() { in_file "$1" || [ -n "$(get "$1")" ]; }

# Check everything before sealing anything.
if ! in_file RABBITMQ_URL && in_file RABBITMQ_DEFAULT_USER; then
  url_safe RABBITMQ_DEFAULT_USER
  url_safe RABBITMQ_DEFAULT_PASS
fi
if ! in_file REDIS_URL && [ -n "$(get REDIS_PASSWORD)" ]; then url_safe REDIS_PASSWORD; fi
missing=""
for k in $REQUIRED; do
  [ -n "$(get "$k")" ] || missing="$missing $k"
done
if [ -n "$missing" ]; then
  echo "[seal] missing or empty in $FILE:$missing" >&2
  exit 1
fi
command -v kubeseal > /dev/null || { echo "[seal] kubeseal not found on PATH" >&2; exit 1; }
if [ -f "$CERT" ]; then
  set -- --cert "$CERT"
  echo "[seal] $NS: encrypting with $CERT"
else
  set --
  echo "[seal] $NS: no $CERT, asking the controller of the current kubectl context"
fi

# Secret manifest on stdout, for kubeseal only.
manifest() {
  printf 'apiVersion: v1\nkind: Secret\ntype: Opaque\nmetadata:\n  name: %s\n  namespace: %s\n' "$1" "$NS"
  printf '  labels:\n    app.kubernetes.io/part-of: geosound\ndata:\n'
  for k in $(keys_of "$1"); do
    if present "$k"; then
      printf '  %s: %s\n' "$k" "$(get "$k" | base64 | tr -d '\n')"
    fi
  done
}

mkdir -p "$OUT"
for name in $SECRETS; do
  keys=""
  for k in $(keys_of "$name"); do
    if present "$k"; then keys="$keys $k"; fi
  done
  if [ -z "$keys" ]; then
    echo "[seal] $name: no key in the file, skipped"
    continue
  fi
  manifest "$name" | kubeseal --format yaml --namespace "$NS" --name "$name" "$@" > "$OUT/$name.yaml.tmp"
  mv "$OUT/$name.yaml.tmp" "$OUT/$name.yaml"
  echo "[seal] $name:$keys -> $OUT/$name.yaml"
done

case " $(ls "$OUT") " in
  *geosound-broker.yaml*) ;;
  *) echo "[seal] note: no geosound-broker; the chart's RabbitMQ and Redis need it unless rabbitmq.enabled and redis.enabled are false" ;;
esac
case " $(ls "$OUT") " in
  *geosound-smtp.yaml*) ;;
  *) echo "[seal] note: no geosound-smtp; auth then prints OTP codes to its log (prod values require it)" ;;
esac
