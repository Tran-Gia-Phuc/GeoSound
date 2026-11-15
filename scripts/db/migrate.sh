#!/bin/sh
# One-shot Prisma migrations for the GeoSound schemas (deployment plan task 0.6, issue #352).
# Runs in the `migrate` compose service (profile `migrate`, service images have the Prisma CLI):
#
#   docker compose --profile migrate run --rm migrate [deploy|status|check|baseline] [service...]
#
#   deploy    (default) apply the pending migrations (prisma migrate deploy).
#   status    list applied and pending migrations (read-only).
#   check     compare the live schema with schema.prisma (read-only; exit 2 = drift).
#   baseline  mark 0_init as applied on a schema that already exists (made by `prisma db push`).
#             It only writes <schema>._prisma_migrations, it changes no table. Run `check` first.
#
# Services: auth tour moderation notification media ai (default: all). Each one uses
# DATABASE_URL_DIRECT_<SVC> (Supabase session pooler 5432: DDL and advisory locks do not work
# through pgbouncer 6543), else DATABASE_URL_<SVC>. A service without a URL is skipped
# (ai in local dev). Prisma folders are mounted at $MIGRATIONS_DIR/<svc> (schema.prisma, migrations/).
set -u

ALL="auth tour moderation notification media ai"
DIR=${MIGRATIONS_DIR:-/migrations}
# Prisma 5 cannot express the HNSW index of ai.chunks (0_init creates it): ignore it in `check`.
ALLOWED_DRIFT='DROP INDEX "chunks_embedding_hnsw_idx";'

cmd=deploy
case "${1:-}" in
  deploy|status|check|baseline) cmd=$1; shift ;;
  -h|--help|help) sed -n '2,17p' "$0"; exit 0 ;;
esac
services=${*:-$ALL}

fail=0
for svc in $services; do
  case " $ALL " in
    *" $svc "*) ;;
    *) echo "[migrate] unknown service: $svc (expected one of: $ALL)"; fail=1; continue ;;
  esac
  upper=$(echo "$svc" | tr '[:lower:]' '[:upper:]')
  eval "url=\${DATABASE_URL_DIRECT_$upper:-\${DATABASE_URL_$upper:-}}"
  if [ -z "$url" ]; then
    echo "[migrate] $svc: no DATABASE_URL_DIRECT_$upper / DATABASE_URL_$upper, skipped"
    continue
  fi
  schema="$DIR/$svc/schema.prisma"
  echo "[migrate] $svc: $cmd"
  case "$cmd" in
    deploy)
      DATABASE_URL="$url" npx --no-install prisma migrate deploy --schema "$schema" || fail=1 ;;
    status)
      DATABASE_URL="$url" npx --no-install prisma migrate status --schema "$schema" || fail=1 ;;
    baseline)
      DATABASE_URL="$url" npx --no-install prisma migrate resolve --applied 0_init --schema "$schema" || fail=1 ;;
    check)
      if ! out=$(npx --no-install prisma migrate diff --from-url "$url" --to-schema-datamodel "$schema" --script); then
        echo "[migrate] $svc: prisma migrate diff failed"; fail=1; continue
      fi
      rest=$(printf '%s\n' "$out" | grep -v -E '^--|^[[:space:]]*$' | grep -v -F "$ALLOWED_DRIFT" || true)
      if [ -n "$rest" ]; then
        echo "[migrate] $svc: DRIFT, the live schema differs from schema.prisma. SQL that would align it:"
        printf '%s\n' "$rest"
        [ "$fail" = 1 ] || fail=2
      else
        echo "[migrate] $svc: no drift"
      fi ;;
  esac
done
exit "$fail"
