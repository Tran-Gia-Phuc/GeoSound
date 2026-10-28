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
| D4 | Who writes the Node part of Moderation | The AI owner. Admin queue and approve/reject (UC#19) are out of scope |
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
| D24 | Other services | Changes to Tour, Gateway and infra are written by the AI team behind flags and merged only by their owners; requests in `docs/02-design/ai-integration-requests.md` |
| D20 | Tour side (PR #213, owner reviews) | Tour stores `moderationRevision` before publishing and applies a result with a conditional update on it; editing a tour or its places while in moderation sends it back to `draft` |


## 3. Current state (2026-10-28)

- **Phases 1 and 2 done** (place text and images, tour content and geo rules), proven by the e2e with the AI stub (9/9 PASS).
- **Phase 3 in progress:** design (#184), tracing (#173), index logic (#185), agent (#187) and hybrid retriever (#186) merged; #188 chat API in progress (AI part, plus gateway PR #227 for its owner).
- Waiting for other owners: **PR #213** (Tour moderation events, #180) and **PR #227** (gateway chat route); requests in `docs/02-design/ai-integration-requests.md`.
- Owner actions: `INTERNAL_SERVICE_TOKEN` in `.env`; never run real Gemini without an explicit request.

Known limits: an event arriving while a DB is down is acked and lost (no DLQ); a tour with more than 50 merged reasons may hide geo reasons; the pgvector store, embedding runtime and indexer transport are stubs until #219.

## 4. Tasks (label `ai-service`)

| Code | Issue | Branch | Status |
| --- | --- | --- | --- |
| AI-25 to AI-38, AI-40 to AI-46 | #166 to #179, #181 to #187 | | merged |
| AI-39 Tour integration (flag) | #180 | `feature/tour-moderation-integration` | PR #213, Tour owner merges |
| AI-47 `POST /chat` + gateway route | #188 | `feature/chatbot-api`, `feature/gateway-chat-route` | in progress; gateway PR #227 merged by its owner |
| AI-48 chatbot evaluation | #189 | `test/chatbot-eval` | after #188 |
| AI-49 pgvector store, embeddings, indexer transport | #219 | `feature/chatbot-pgvector` | after the pgvector image and Tour events are agreed |

## 5. Notes for the next tasks

| Task | Note |
| --- | --- |
| all Node tasks | Only `src/index.js` may import `../shared/...`; inject `validateEvent` / `publish` elsewhere (CI runs tests from the repo layout, where `../shared` does not exist). Test helpers load shared with a dynamic import that tries the repo path, then the image path |
| all tasks | Merge only when no CI check fails; for the known flaky UI test, rerun the failed job first (`gh run rerun <id> --failed`) |
| #185 to #189 | Follow `chatbot-architecture.md`. One LLM call per normal turn; tests use FakeLLM and a fake retriever/embedder; no real Gemini |
| #188 | Render or strip `[tour:ID]` / `[place:ID]` markers; on a provider error remove the just-saved user message from memory; hide tool inputs (lat/lng) from LangSmith traces; Postgres checkpointer, session TTL, `CHATBOT_ENABLED`, global chat cap; stream tokens only after `cite` (or buffer markers) so invented markers never reach the client; history entries need `citations?` and `at` |
| #219 | pgvector store, e5 embedding runtime in the image, AMQP transport for the indexer, Postgres chat checkpointer with message metadata (`at`, citations) |
