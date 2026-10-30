# AI and Moderation: plan, decisions and tasks

Companion of `CLAUDE.md` (rules and contracts). This file changes often: decisions, current state, task list.
Architecture V4 (accepted 2026-10-27): `docs/02-design/moderation-architecture.md`. AI spec: `docs/02-design/ai-service-spec.md` (v3.0).

## 1. Features

| # | Feature | Phase |
| --- | --- | --- |
| F1 | Place moderation: Tour sends `place.submitted` (text, coordinates, images) → Moderation → AI → `place.ai_passed` / `place.ai_rejected` back to Tour | 1 text, 2 images |
| F2 | Tour moderation: Tour sends `tour.submitted` → Moderation runs geo rules (pure JS) and calls AI for content (title, description, coherence) → merged result `tour.ai_passed` / `tour.ai_rejected`. Places are not moderated again | 1 |
| F3 | Travel chatbot: LangGraph agent + LangChain + LangSmith, multi-layer graph RAG over public tours and places | 3 |

## 2. Decisions

Everything is additive and behind a feature flag, so nothing breaks for other teammates. If real code contradicts a decision, report it and adapt; do not guess.

| # | Question | Decision |
| --- | --- | --- |
| D1 | Event contract | `docs/02-design/moderation-architecture.md` section 6.1. New keys on existing events are optional; `tour.ai_rejected.reason` stays a string (Notification consumes it) |
| D2 | Who emits `*.submitted` | Tour, only when `MODERATION_EVENTS_ENABLED=true` (default false = today's direct publish). `place.submitted` on place create/edit; `tour.submitted` on submit, status `ai_checking` |
| D3 | Who consumes results | Tour, queue `tour.moderation-results`. Tour: `ai_passed` → `pending_review` (or `ai_warning` when `warning`), `ai_rejected` → `draft` with reasons. Place gets `moderationStatus` (`checking`, `approved`, `warning`, `rejected`) and `moderationReasons` |
| D4 | Who writes the Node part of Moderation | The AI owner. Admin queue and approve/reject (UC#19) were handed over on 2026-10-30 and live in Tour (#243), see D27 |
| D5 | Tour submit while places are unchecked | Tour blocks submit if a place is `checking` or `rejected`; `warning` does not block |
| D6 | Image URLs | Supabase Storage public URLs (`services/media/.../supabase-storage.js`); `IMAGE_ALLOWED_HOSTS` = the Supabase host |
| D7 | Place without a tour | Dropped: `Place.tourId` is required in the Tour schema, so `tourId` is required in `place.submitted` |
| D8 | HTTP naming | snake_case on the wire like `/translate`; Moderation converts in `application/dtos/ai-mapping.js` only |
| D9 | Oversized text | Moderation truncates to the limits before calling AI |
| D10 | Duplicates | One case per `(subjectType, subjectId, revision)`; an existing result is re-published without a new AI call |
| D11 | Retry and failure | 3 attempts (2 s, 4 s) on timeout, 429, 503, network. After that: `ai_failed`, publish nothing, sweeper retries. 422: `failed_permanent` and publish a Warning so a human reviews it. 401 (bad token, configuration): `ai_failed`, no publish |
| D12 | Frameworks | Moderation: plain Python + optional LangSmith tracing (`LANGSMITH_TRACING=false`). Chatbot: LangGraph + LangChain + LangSmith, graph + vector RAG |
| D13 | Quota | Moderation prefetch 2 + a semaphore in AI; Groq absorbs text-only overflow |
| D14 | Geo rules | Moderation `domain/geo/tour-geo-rules.js`, rules G1 to G6, limits per tour type; only G1 (invalid coordinate) rejects; findings use category `route` |
| D15 | Forbidden zones | Already checked by Tour when a place is added; Moderation does not repeat it |
| D16 | Concurrency | Every move into `reviewing` and every re-publish claims the case with a compare-and-set (`claim`), so a sweep and a consumer never process the same case twice |
| D17 | Sweeper | Every 60 s: retries `ai_failed` and stale `pending` / `reviewing` cases, and re-publishes `done` / `failed_permanent` results whose publish failed. `RETRY_STALE_AFTER_MS` must exceed the worst-case review time |
| D18 | Images | AI fetches images itself (https, host allowlist, no redirects, type + magic bytes, 3 MB). Permanent image problem → Warning `images[n]`; temporary → 503. Moderation stores `imagesChecked` and downgrades a Pass with unexplained unchecked images to Warning |
| D19 | Tour edge cases | No `revision` → skipped; missing title / language / places → human-review Warning without an AI call; temporary AI failure publishes nothing even when G1 fired (whole review retried) |
| D21 | Chatbot data | Tour publishes `tour.published` / `tour.unpublished` behind `CHATBOT_EVENTS_ENABLED`; the AI indexer is the only RabbitMQ consumer in the AI service |
| D22 | Chatbot store | pgvector on the shared Supabase Postgres (extension `vector`, schema `ai`, `DATABASE_URL_AI`); graph as edge tables; local multilingual embeddings. Moderation also runs on Supabase (schema `moderation`) since 2026-10-28 |
| D23 | Chatbot auth | Gateway JWT checks skipped for now: anonymous sessions by `session_id`; gateway adds `x-internal-token` and chat rate limits |
| D24 | Other services | Changes to Tour, Gateway and infra are written by the AI team behind flags and merged by their owners, or by us when the owner hands the task over (the Tour owner did on 2026-10-30 for #213 and #240); requests in `docs/02-design/ai-integration-requests.md` |
| D20 | Tour side (PR #213, merged) | Tour stores `moderationRevision` before publishing and applies a result with a conditional update on it; editing a tour or its places while in moderation sends it back to `draft` |
| D25 | Tour catalog events (#240) | Behind `CHATBOT_EVENTS_ENABLED`: `tour.published` when a tour becomes `public` and re-sent when a public tour's places, languages, translations or a place moderation result change; `tour.unpublished` on unpublish / edit back to draft / delete. Only places not `checking` / `rejected` are sent. `revision` = max(`updatedAt`, send time) so re-sends are never stale |
| D26 | Chat model | `thinking_budget=0` for Gemini chat (#238): `gemini-2.5-flash` counts thinking in `max_output_tokens` and cut answers at 512 tokens |
| D27 | Admin review (UC#19, #243) | In Tour, routes `/admin/reviews` (role `admin`): queue (`ai_warning` first, then oldest), read-only dossier, approve -> `public` (`tour.approved` + `tour.published`), reject with reason -> `rejected` (`tour.rejected`), request changes with reason -> new status `changes_requested` (`tour.changes_requested`, author resubmits). Conditional writes from `ai_warning` / `pending_review` only (409 otherwise); every decision logged in `tour_review_actions` (UC22) |
| D28 | Signed-in devices (UC23, #247 backend, #248 client) | Design `docs/02-design/device-sessions.md`: `auth.sessions`, `sid` in tokens, refresh rotation with reuse detection, revocation in Redis checked by `verifyJwt`, no business limit (cap `AUTH_MAX_SESSIONS`=100), new-device email (demo inbox `SECURITY_ALERT_TO` in `.env`, never in the repo) |


## 3. Current state (2026-10-30)

- **Phases 1, 2 and 3 work end to end on the real stack** (Supabase, RabbitMQ, real Gemini), checked on 2026-10-30:
  - place moderation (approved / rejected with reasons, publish blocked by a rejected place), tour moderation (`ai_warning` / `pending_review`), edit while in review withdraws to `draft`;
  - chatbot: Tour publish → `tour.published` → indexer (pgvector, schema `ai`) → `/chat` answers with citations; unpublish removes the tour.
- Tour schema `tour` on Supabase has the moderation columns (pushed 2026-10-30, additive).
- Both Tour flags are off by default. To turn the full flow on: `MODERATION_EVENTS_ENABLED=true` and `CHATBOT_EVENTS_ENABLED=true` in `.env`, plus `INTERNAL_SERVICE_TOKEN`, `CHATBOT_ENABLED`, `CHATBOT_INDEXER_ENABLED`, `DATABASE_URL_AI`, `DATABASE_URL_DIRECT_AI` (and `CHAT_MEMORY_BACKEND=postgres` for shared chat memory).
- Nothing waits for other owners. With moderation on, a tour stops at `pending_review` until an admin decides through `/api/tours/admin/reviews` (UC#19, #243). The Supabase password shared in chat must be reset by the project owner.
- Never run real Gemini without an explicit request.

Known limits: an event arriving while a DB is down is acked and lost (no DLQ); a tour with more than 50 merged reasons may hide geo reasons; "near X" questions use a 500 m radius (`NEARBY_RADIUS_M`).

## 4. Tasks (label `ai-service`)

| Code | Issue | Branch | Status |
| --- | --- | --- | --- |
| AI-25 to AI-46 | #166 to #187 | | merged (AI-39 Tour integration: PR #213) |
| AI-47 `POST /chat` + gateway route | #188 | `feature/chatbot-api`, `feature/gateway-chat-route` | merged (PR #229, PR #227) |
| AI-48 chatbot evaluation | #189 | `test/chatbot-eval` | merged (offline; real-model baseline only on request) |
| AI-49 pgvector store, embeddings, indexer transport, chat memory | #219 | | merged (PRs #232 to #237) |
| full-flow fixes: chat thinking budget, app logs | #238 | `fix/chat-thinking-budget` | merged (PR #239) |
| Tour `tour.published` / `tour.unpublished` | #240 | `feature/tour-chatbot-events` | merged (PR #241) |
| UC19 admin review backend | #243 | `feature/uc19-admin-review` | merged (PR #244); schema `tour` pushed to Supabase 2026-10-30 |
| UC23 signed-in devices, Auth backend | #247 | `feature/uc23-device-sessions` | in progress |
| UC23 signed-in devices, client screen | #248 | | after #247 |

## 5. Notes for the next tasks

| Task | Note |
| --- | --- |
| all Node tasks | Only `src/index.js` may import `../shared/...`; inject `validateEvent` / `publish` elsewhere (CI runs tests from the repo layout, where `../shared` does not exist). Test helpers load shared with a dynamic import that tries the repo path, then the image path |
| all tasks | Merge only when no CI check fails; for the known flaky UI test, rerun the failed job first (`gh run rerun <id> --failed`) |
| #185 to #189 | Follow `chatbot-architecture.md`. One LLM call per normal turn; tests use FakeLLM and a fake retriever/embedder; no real Gemini |
| #188 | Done: `/api/chat` and `/api/chat/history` checked through the gateway on 2026-10-30 |
| full-flow test | How it was run on 2026-10-30: Tour on a disposable Postgres (`postgis/postgis:16-3.4` on the compose network, `DATABASE_URL` and flags set in a compose override, never in `.env`), a contributor JWT signed inside the tour container with `JWT_ACCESS_SECRET`, calls through the gateway. Never write test data to the shared Supabase schemas of other services |
| moderation tokens | Moderation calls Gemini through `GeminiClient.generate_json` (default `max_tokens` 2048) with thinking on. Fine for the tested tours; if a large tour (close to 50 places) returns invalid JSON, check `finish_reason=MAX_TOKENS` and set a thinking budget there too |
| partial PRs | A branch made with `gh issue develop` is linked to the issue, and merging its PR closes the issue even with "Part of #N". For a partial PR create the branch with `git switch -c` and write "Part of #N" |
| #219 | Schema `ai` is defined in `services/ai/prisma/schema.prisma` (tables) plus `prisma/pre-push.sql` (vector extension, schema `ai`) and `prisma/post-push.sql` (CHECK constraints, HNSW index), pushed with the auth image (`docs/04-guides/supabase-access.md` section 4); pgvector store, e5 embedding runtime in the image, AMQP transport for the indexer. Chat memory (part D): `CHAT_MEMORY_BACKEND=postgres` uses the official `AsyncPostgresSaver` (`langgraph-checkpoint-postgres` 3.2, psycopg 3.3) over `DATABASE_URL_DIRECT_AI`, in its own schema `ai_chat` (created at startup, never in Prisma-managed `ai`), plus `ai_chat.chat_sessions` / `chat_messages` for `at`, citations and TTL; `memory` stays the default. Integration tests need `AI_TEST_DATABASE_URL` (disposable DB) |
| follow-ups | (1) Geo reasons from Moderation are always English while AI reasons follow the tour language: localise `tour-geo-rules.js` messages by `language`. (2) Tour events carry no `contributorEmail`, so Notification logs "thiếu contributorEmail" and sends no email (true for every tour event, not only UC19): Notification should look the email up by `contributorId` (Auth owner decides how) |
