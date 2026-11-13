# Supabase: access and setup for teammates

GeoSound uses one shared Supabase project as its Postgres host. Every service owns one schema in it
(`app_auth`, `tour`, `media`, `notification`, `moderation`, `ai`). See `docs/tech-stack.md` for the reasons.

There are two kinds of access, and they are not the same thing:

| Access | Gives you | How you get it |
| --- | --- | --- |
| Connection strings in your local `.env` | Your services can read and write the database | The project owner sends them to you privately |
| A seat in the Supabase project (dashboard) | Settings, SQL editor, extensions, storage, password reset, logs | The project owner invites your Supabase account |

The repository never contains connection strings, passwords, project ids or invite links. `.env` is git-ignored.

## 1. Get a seat in the project (dashboard)

The project owner:

1. Opens the Supabase dashboard, then **Organization settings -> Team** (called **Members** in some versions).
2. Clicks **Invite**, enters the teammate's Supabase account email, and picks a role:
   - `Developer`: can use the SQL editor, see data and logs. Enough for most teammates.
   - `Administrator`: like Owner for the project (password reset, extensions) but without billing and deleting the organization.
   - `Owner`: full control, including billing, password reset and deleting the project. Give it sparingly.
   - `Read-only`: can only look.
3. Sends the invite.

The teammate:

1. Signs in (or signs up) at supabase.com with the invited email.
2. Accepts the invitation from the email or from the dashboard notification.
3. Sees the GeoSound project in the project list.

## 2. Get the connection strings

Never paste them in chats, issues, pull requests or commits. Share them in a private channel (password manager,
direct message that you can delete).

Every service uses two variables in `.env` (root of the repository):

| Variable | Pooler | Used for |
| --- | --- | --- |
| `DATABASE_URL_<SERVICE>` | Transaction pooler, port 6543, `pgbouncer=true&schema=<schema>` | The running service |
| `DATABASE_URL_DIRECT_<SERVICE>` | Session pooler, port 5432, `schema=<schema>` | `prisma db push` and other schema changes |

The values come from the dashboard: the **Connect** button in the project header (newer dashboards) or
**Project settings -> Database -> Connection string** (older ones); choose the pooler mode.
Write them without quotes. Each key appears once in `.env`. `.env.example` lists every key with placeholders.

## 3. If a password leaks

If a connection string or password was shared in a public place (chat, issue, commit):

1. A dashboard Owner resets it: **Project settings -> Database -> Reset database password**.
2. The owner sends the new strings privately to the team.
3. Everybody updates their `.env` and restarts: `docker compose up -d`.

## 4. Schema changes: Prisma migrations

Since deployment plan task 0.6 (issue #352) every schema is managed by **Prisma migrations**
(`services/<svc>/prisma/migrations/`). Rules for the whole team:

- **Never run `prisma db push` against Supabase again.** It changes the schema without a record, can drop
  columns, and does not match what the migrations build.
- No container changes the schema when it starts (`auth` and `moderation` used to run `db push`).
- A change in `schema.prisma` always comes with a new migration folder in the same PR. CI fails otherwise
  (`scripts/db/check-migrations.sh`, step "Prisma migrations match schema.prisma").
- Never edit a migration that was already applied: Prisma stores its checksum. Fix it with a new one.

### 4.1 Apply migrations

From the repository root, with the `DATABASE_URL_DIRECT_<SVC>` keys in `.env` (session pooler 5432; DDL and
Prisma's advisory lock do not work through pgbouncer 6543):

```bash
docker compose --profile migrate run --rm migrate                  # deploy, every service
docker compose --profile migrate run --rm migrate deploy tour      # one service
docker compose --profile migrate run --rm migrate status           # applied / pending (read-only)
docker compose --profile migrate run --rm migrate check            # live schema vs schema.prisma (read-only)
```

The `migrate` service (`docker-compose.yml`, profile `migrate`, never started by `up`) runs
`scripts/db/migrate.sh` in the tour image, with every `prisma` folder mounted read-only. A service without
`DATABASE_URL_DIRECT_<SVC>` falls back to `DATABASE_URL_<SVC>`, and is skipped when both are empty (`ai` in
local dev). Prisma prints the database host and name (never the password): do not paste that output in public
places. `check` exits with 2 when it finds a drift and prints the SQL that would remove it.

### 4.2 One-time baseline of an existing database

A schema made earlier by `db push` (Supabase, or an old local database) already has its tables, so
`migrate deploy` stops with `P3005` (schema not empty). Baseline it once per service:

```bash
docker compose --profile migrate run --rm migrate check tour       # must say "no drift"
docker compose --profile migrate run --rm migrate baseline tour    # marks 0_init as applied
docker compose --profile migrate run --rm migrate deploy tour      # "No pending migrations to apply"
```

`baseline` runs `prisma migrate resolve --applied 0_init`: it creates `<schema>._prisma_migrations` with one
row and changes no table. If `check` shows a drift, do not baseline: fix the drift first (or ask in the team
channel which side is right). On Supabase this is done once by the project owner, not by every teammate.

### 4.3 Add a migration after changing `schema.prisma`

Generate the SQL offline from the schema on `develop` to your new schema (no database needed; Git Bash on
Windows, use `$PWD` instead of `$(pwd -W)` on Linux and macOS):

```bash
export MSYS_NO_PATHCONV=1
svc=tour; dir=services/$svc/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_add_place_rating
mkdir -p "$dir"
git show origin/develop:services/$svc/prisma/schema.prisma > services/$svc/prisma/old.prisma
docker run --rm --network none -v "$(pwd -W)/services/$svc/prisma:/p:ro" --entrypoint sh geosound-tour \
  -c "npx prisma migrate diff --from-schema-datamodel /p/old.prisma --to-schema-datamodel /p/schema.prisma --script" \
  > "$dir/migration.sql"
rm services/$svc/prisma/old.prisma
```

Then read `migration.sql` before you commit it:

- A renamed column or table shows up as a drop plus an add, which loses data: rewrite it as `ALTER ... RENAME`.
- A new required column on a table with rows needs a default, or two migrations (add nullable, fill, then
  set `NOT NULL`).
- Old and new pods run side by side during a rollout: keep each change backward compatible (expand now,
  contract in a later release; deployment plan section 8.5).

Apply it locally with `migrate deploy <svc>`, run `sh scripts/db/check-migrations.sh` (needs a disposable
Postgres with pgvector in `SHADOW_DATABASE_URL`, never Supabase) or let CI run it, and commit the folder with
the `schema.prisma` change. After the merge, the owner applies it on Supabase with `migrate deploy <svc>`;
later the Kubernetes migrate Job does it before each rollout.

### 4.4 The AI schema (`ai`, pgvector)

- `ai/prisma/migrations/0_init` also holds what `pre-push.sql` and `post-push.sql` did: it enables `vector`
  in schema `extensions`, then adds the CHECK constraints, the partial index `nodes_place_geo_idx` and the
  HNSW index `chunks_embedding_hnsw_idx`. The two old files stay for the pgvector integration test
  (`services/ai/tests/test_pgvector_store.py`) and as a record; do not use them on Supabase any more.
- If enabling `vector` fails with a permission error, a dashboard Owner or Administrator enables it in
  **Database -> Extensions** (schema `extensions`; if `vector` is installed in `public`, move it first).
- Prisma 5 cannot express an HNSW index, so a diff against `schema.prisma` always proposes
  `DROP INDEX "chunks_embedding_hnsw_idx"`. Both scripts ignore that one line; never apply it. Remove it by hand
  if it shows up in a new AI migration.
- The chat memory (`CHAT_MEMORY_BACKEND=postgres`) uses its own schema `ai_chat`, created by the AI service at
  startup through `DATABASE_URL_DIRECT_AI`. It is not in `schema.prisma` and no migration touches it.
