# AI integration: requests to other services

Status: agreed by the AI owner on 2026-10-28; each item needs the owner of that service to accept it in review.
Audience: owners of Tour, Gateway and the shared infrastructure (Postgres, compose).
Background: `moderation-architecture.md` (moderation, phases 1 and 2) and `chatbot-architecture.md` (chatbot, phase 3).

Everything below is **additive and behind a feature flag**. With the flags off, nothing changes for your service.
The AI team writes the code where it says so and opens a PR for your review; we never merge changes to your service.

## Summary

| # | Service | What | Flag | Who writes it | Needed for |
| --- | --- | --- | --- | --- | --- |
| 1 | Tour | Review and merge PR #213 (moderation events) | `MODERATION_EVENTS_ENABLED` | AI team (done), Tour owner reviews | Moderation in production |
| 2 | Tour | Publish `tour.published` / `tour.unpublished` | `CHATBOT_EVENTS_ENABLED` | AI team, Tour owner reviews | Chatbot index (#185) |
| 3 | Infra | Enable `vector` and schema `ai` on Supabase, `DATABASE_URL_AI` | none | Project owner on the Supabase dashboard | Chatbot store (#219) |
| 4 | Gateway | `/api/chat` route (SSE, no buffering), chat rate limits, `x-internal-token` | `CHATBOT_ENABLED` | AI team, Gateway owner reviews | Chat API (#188) |
| 5 | shared/events | Schemas for `tour.published` / `tour.unpublished` | none | AI team | Items 2 and 4 |

## 1. Tour: moderation events (PR #213)

Already written and green in CI: https://github.com/Tran-Gia-Phuc/GeoSound/pull/213

Before deploying, whatever the flag value:

- Run `npx prisma db push` for schema `tour`. The new columns are additive with defaults; existing places become
  `approved`.
- `MODERATION_EVENTS_ENABLED` and `RABBITMQ_URL` reach Tour through `env_file: .env`.

Behaviour with the flag on, and the four points for you to decide, are in the PR description.

## 2. Tour: chatbot events

The chatbot must only answer about **public** tours, so Tour tells the AI service when a tour enters or leaves
`public`.

Status: implemented in #240 (`services/tour`, flag `CHATBOT_EVENTS_ENABLED`). Tour also re-sends `tour.published`
when a place or translation of a public tour changes; `revision` is the later of `updatedAt` and the event time, so
every re-send is newer than the indexed one.

| Event | When | Payload (camelCase, `at` ends with `Z`) |
| --- | --- | --- |
| `tour.published` | A tour becomes `public` (publish, or Admin approval later) | `tourId`, `revision` (Tour `updatedAt`), `status` (`public`), `title`, `description`, `language`, `city?`, `type`, `durationMinutes?`, `languages?[]`, `places[{placeId, name, type?, description, lat, lng, sequence, translations?[{language, text}]}]` (max 50), `at?` |
| `tour.unpublished` | A tour leaves `public`: unpublish, edit back to `draft`, hide, restrict, delete | `tourId`, `revision?`, `reason` (`unpublished`, `edited`, `hidden`, `restricted`, `deleted`), `at?` |

- Published only when `CHATBOT_EVENTS_ENABLED=true` (default `false`).
- Emitted after the database write succeeds; a failed publish is logged and never fails the user request.
- The AI indexer re-checks `status` and `revision` and deletes everything about a tour on `tour.unpublished`, so a
  duplicate or late event is harmless.

## 3. Infrastructure: Supabase (pgvector)

All services already use the shared Supabase Postgres, one schema per service (moderation moved there on 2026-10-28).
The chatbot stores text chunks, vectors and a small graph in the same database, schema `ai`.

Once per Supabase project:

1. In `.env`: `DATABASE_URL_AI` (transaction pooler 6543, `pgbouncer=true&schema=ai`) and `DATABASE_URL_DIRECT_AI` (session pooler 5432, also with `?schema=ai`, otherwise `db push` writes to `public`) for schema changes, written like the other services and without quotes (`docker --env-file` keeps them).
2. Push the schema with the command in `docs/04-guides/supabase-access.md` section 4. It runs `pre-push.sql`
   (enables `vector` in schema `extensions` and creates schema `ai`), then `prisma db push`, then `post-push.sql`.
   Only if `pre-push.sql` fails with a permission error does a dashboard Owner need to enable `vector` in
   Database -> Extensions.

Tables are defined in `services/ai/prisma/schema.prisma`; `post-push.sql` adds the CHECK constraints, the place geo
index and the HNSW vector index. How teammates get dashboard access and connection strings:
`docs/04-guides/supabase-access.md`. No custom Postgres image is needed for the team; the local `postgres` container
stays for offline development only (it has no pgvector, so the chatbot store runs only against Supabase).

Media storage (owned by the media service): images are still stored on local disk because `SUPABASE_URL` is not set.
To enable Supabase Storage, create a public bucket `geosound-media` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_STORAGE_BUCKET`. Until then, AI image moderation refuses all image hosts and places with images get a
human-review Warning.

## 4. Gateway: chat route

| Item | Value |
| --- | --- |
| Routes | `POST /api/chat` → `ai:3004/chat` (Server-Sent Events), `GET /api/chat/history` → `ai:3004/chat/history` |
| Streaming | The proxy must not buffer the response (`text/event-stream`), so tokens reach the client as they are produced |
| Internal token | The gateway adds `x-internal-token: $INTERNAL_SERVICE_TOKEN`; the browser never sees it |
| Rate limits | Per user or IP: `CHAT_RATE_LIMIT_PER_MIN` (default 5) and 100 per day; global: `CHAT_GLOBAL_RATE_LIMIT_PER_MIN` (default 2 turns per minute on Gemini, overflow to Groq) so moderation keeps the shared Gemini quota |
| Auth | **JWT checks are skipped for now** (decision 2026-10-28). Sessions are anonymous, identified by `session_id`. When the gateway gets JWT checks, `/api/chat` will use them |
| Flag | `CHATBOT_ENABLED=false` hides both routes |

## 5. shared/events

The AI team adds `tour.published` and `tour.unpublished` to `shared/events/index.js` (zod, additive), with tests,
before item 2. No existing event changes.

## Exception to the AI service rules

`CLAUDE.md` says the AI service does not listen to RabbitMQ. That rule stays for moderation. The **chatbot indexer**
is the only allowed exception: it consumes `tour.published` and `tour.unpublished` (and `tour.hidden` if a service
publishes it later).

## Contact

Questions or objections: comment on the related issue (#185 for items 2, 3 and 5; #188 for item 4) or on PR #213.
