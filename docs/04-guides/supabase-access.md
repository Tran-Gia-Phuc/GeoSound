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

## 4. One-time setup for the AI chatbot schema

Needed once per Supabase project, and again after any change in `services/ai/prisma/`. From the repository root,
after `DATABASE_URL_AI` and `DATABASE_URL_DIRECT_AI` are in `.env` (same as the other services, `schema=ai`):

```bash
MSYS_NO_PATHCONV=1 docker run --rm --env-file .env -v "$PWD/services/ai/prisma:/p:ro" -w /app cnpm-main-auth \
  sh -c 'export DATABASE_URL="$DATABASE_URL_DIRECT_AI"; \
  npx prisma db execute --file /p/pre-push.sql --schema /p/schema.prisma \
  && npx prisma db push --skip-generate --schema /p/schema.prisma \
  && npx prisma db execute --file /p/post-push.sql --schema /p/schema.prisma'
```

- `pre-push.sql` enables the `vector` extension (schema `extensions`) and creates schema `ai`. If it fails with a
  permission error, a dashboard Owner or Administrator enables `vector` in **Database -> Extensions** (schema
  `extensions`; if `vector` is already installed in `public`, move it to `extensions` first) and you run the command again.
- `post-push.sql` adds the CHECK constraints and the vector index.
- The command passes `.env` to the container and never prints it.

The other services push their own schema when they start (`prisma db push` in their Dockerfile).
