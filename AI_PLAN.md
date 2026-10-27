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

## 3. Current state

**Goal: finish place moderation (F1, text and images) and tour moderation (F2) end to end before anything else.** LangSmith tracing and the chatbot come after.

- Merged before V4: #AI-01 to #AI-10 (issues #5 to #14). Scaffold of V4 files: PR #190.
- Merged in V4 (2026-10-27):
  - #166 architecture V4 and spec v3.0 (PR #191)
  - #167 shared events: `place.*`, extended `tour.*`, `reasonSchema` with category `route` (PR #192)
  - #168 env and compose variables, `moderation` depends on `ai` (PR #193)
  - #169 `x-internal-token` on `/moderate/*`, fail closed; `validator.py` (`clip`, `sanitize_text`, `wrap`) already used by the old `/moderate` prompt (PR #194)
  - #174 `ModerationCase` model, state machine, `mergeVerdicts`, Prisma and in-memory repositories (PR #195)
  - #176 tour geo rules G1 to G6, `config.geo` from `GEO_*` (PR #196)
- Closed as superseded: #15 to #22 and #60 to #65 (old design).
- Still old code in AI: `moderation/service.py`, `POST /moderate` (`stops`), `prompts/text_moderation.txt`, `events/` package; `schema.py` has no `irrelevant` category and keeps its own limit constants (to import from `validator.py`). Replaced by #170 to #172.
- Local `.env` (owner action): set `INTERNAL_SERVICE_TOKEN` (long random value), otherwise every `/moderate/*` call is 401. After the next `docker compose up --build`, check `docker compose logs moderation`: if `db push skipped` appears (old `moderation_logs` table had rows), run `npx prisma db push --accept-data-loss` once for the moderation schema.
- CI (`.github/workflows/ci.yml`): node syntax check, `prisma validate`, `npm test --workspaces --if-present` (now runs `shared` and `moderation` tests), client build. Python tests are not in CI.

## 4. Tasks (label `ai-service`)

Work in this order (a step starts when its dependencies are merged; tasks in the same step are independent):

| Step | Code | Issue | Branch | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| done | AI-25, 26, 27, 28, 33, 35 | #166 to #169, #174, #176 | | | merged |
| 1 | AI-29 place text moderation | #170 | `feature/ai-place-moderation` | 28 | |
| 1 | AI-34 HTTP AI reviewer | #175 | `feature/moderation-ai-reviewer` | 33 | |
| 2 | AI-30 `POST /moderate/place` | #171 | `feature/ai-moderate-place-endpoint` | 29 | |
| 2 | AI-36 place flow | #177 | `feature/moderation-place-flow` | 26, 33, 34 | |
| 3 | AI-31 tour content + `POST /moderate/tour` | #172 | `feature/ai-tour-moderation` | 30 | |
| 3 | AI-38 retry sweeper | #179 | `feature/moderation-retry-job` | 36 | |
| 4 | AI-37 tour flow | #178 | `feature/moderation-tour-flow` | 31, 35, 36 | |
| 4 | AI-41 place images (AI) | #182 | `feature/ai-place-images` | 30 | |
| 5 | AI-42 images through Moderation | #183 | `feature/moderation-place-images` | 36, 41 | |
| 5 | AI-39 Tour integration (flag) | #180 | `feature/tour-moderation-integration` | 26; open PR only, the Tour owner reviews and merges | |
| 6 | AI-40 e2e script | #181 | `test/moderation-e2e` | 37, 42 (39 for the real Tour round trip; a stub Tour publisher is enough before it) | |
| later | AI-32 LangSmith tracing | #173 | `feature/ai-langsmith-tracing` | 30 | optional |
| later | AI-43 to AI-48 chatbot | #184 to #189 | | 43 first | phase 3 |

Place images (#182, #183) moved before tracing and the chatbot: place moderation covers text and images.

## 5. Notes for the next tasks (found while building the merged tasks)

| Task | Note |
| --- | --- |
| #170, #171 | Add `irrelevant` to `Category` in `schema.py`; new schemas import limits from `validator.py`; build prompts only with `validator.wrap()` |
| #172 | Delete `moderation/service.py`, `prompts/text_moderation.txt`, the `events/` package and old `POST /moderate` with its tests |
| #177 | `shared/rabbitmq` `consume()` has no prefetch: add an optional `{ prefetch }` argument (additive, other services unchanged) for D13. Cap published `reasons` at 50 and `reason` at 1000 characters (`reasonSchema` limits) |
| #178 | Same caps after merging geo and AI reasons. Geo `field` `places[i]` uses the order after sorting by `sequence`; also put the `placeId` in the message so Tour can map it |
| #179 | Stale `reviewing` cases (crash during the AI call) go `reviewing -> ai_failed -> reviewing`. Stubs still say `#AI-29`: rename to `#AI-38` |
| #180 | Tour must store reasons from both sources and show geo messages (English only) |
