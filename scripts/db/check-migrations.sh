#!/bin/sh
# Checks that prisma/migrations of every service builds exactly its schema.prisma
# (deployment plan task 0.6, issue #352). Used by CI; also runs locally.
#
#   SHADOW_DATABASE_URL=postgresql://user:pass@host:5432/db sh scripts/db/check-migrations.sh
#
# SHADOW_DATABASE_URL must be a DISPOSABLE Postgres with pgvector (Prisma replays the migrations
# there and resets it; one schema check_<svc> per service). Never point it at Supabase.
# On failure: a schema.prisma change has no migration. Add one (docs/04-guides/supabase-access.md).
set -eu
: "${SHADOW_DATABASE_URL:?set SHADOW_DATABASE_URL to a disposable Postgres with pgvector}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# Prisma 5 cannot express the HNSW index of ai.chunks (0_init creates it).
ALLOWED_DRIFT='DROP INDEX "chunks_embedding_hnsw_idx";'

fail=0
for dir in "$ROOT"/services/*/prisma; do
  svc=$(basename "$(dirname "$dir")")
  if [ ! -d "$dir/migrations" ]; then
    echo "FAIL $svc: no prisma/migrations folder"; fail=1; continue
  fi
  if ! out=$(npx --no-install prisma migrate diff --from-migrations "$dir/migrations" \
      --to-schema-datamodel "$dir/schema.prisma" \
      --shadow-database-url "$SHADOW_DATABASE_URL?schema=check_$svc" --script); then
    echo "FAIL $svc: prisma migrate diff failed"; fail=1; continue
  fi
  rest=$(printf '%s\n' "$out" | grep -v -E '^--|^[[:space:]]*$' | grep -v -F "$ALLOWED_DRIFT" || true)
  if [ -n "$rest" ]; then
    echo "FAIL $svc: prisma/migrations does not build schema.prisma. Missing migration:"
    printf '%s\n' "$rest"
    fail=1
  else
    echo "ok   $svc"
  fi
done
exit "$fail"
