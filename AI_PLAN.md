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

- Merged: #AI-01 to #AI-10 (issues #5 to #14): spec v1, skeleton, config, `/health`, Gemini and Groq clients with fallback, schema, `policy.py`, old `POST /moderate`, tests. Scaffold of V4 files (PR #190): stubs that throw `not implemented`.
- Closed as superseded: #15 to #22 and #60 to #65 (old design).
- Reusable: `llm/*`, `policy.py`, `schema.py` (to extend), `FakeLLM`. To replace: `moderation/service.py`, old `POST /moderate`, `prompts/text_moderation.txt`, `events/` package.
- CI (`.github/workflows/ci.yml`): node syntax check, `prisma validate`, `npm test --workspaces --if-present`, client build. Python tests are not in CI: run them in Docker (`CLAUDE.md` section 7).

## 4. Tasks (label `ai-service`)

| Code | Issue | Branch | Phase | Depends on |
| --- | --- | --- | --- | --- |
| AI-25 architecture V4 and spec | #166 | `docs/ai-moderation-architecture-v4` | 1 | |
| AI-26 shared events | #167 | `feature/events-moderation-contract` | 1 | 25 |
| AI-27 env and compose | #168 | `chore/ai-env-compose` | 1 | |
| AI-28 auth and validator | #169 | `feature/ai-auth-validator` | 1 | |
| AI-29 place text moderation | #170 | `feature/ai-place-moderation` | 1 | 28 |
| AI-30 `POST /moderate/place` | #171 | `feature/ai-moderate-place-endpoint` | 1 | 29 |
| AI-31 tour content + `POST /moderate/tour` | #172 | `feature/ai-tour-moderation` | 1 | 30 |
| AI-32 LangSmith tracing | #173 | `feature/ai-langsmith-tracing` | 1 | 30 |
| AI-33 case persistence and state | #174 | `feature/moderation-case-state` | 1 | |
| AI-34 HTTP AI reviewer | #175 | `feature/moderation-ai-reviewer` | 1 | 33 |
| AI-35 tour geo rules | #176 | `feature/moderation-geo-rules` | 1 | |
| AI-36 place flow | #177 | `feature/moderation-place-flow` | 1 | 26, 33, 34 |
| AI-37 tour flow | #178 | `feature/moderation-tour-flow` | 1 | 35, 36 |
| AI-38 retry sweeper | #179 | `feature/moderation-retry-job` | 1 | 36 |
| AI-39 Tour integration (flag) | #180 | `feature/tour-moderation-integration` | 1 | 26; PR reviewed by the Tour owner, not merged by us |
| AI-40 e2e script | #181 | `test/moderation-e2e` | 1 | 37, 39 |
| AI-41 place images (AI) | #182 | | 2 | 30 |
| AI-42 images through Moderation | #183 | | 2 | 36, 41 |
| AI-43 to AI-48 chatbot | #184 to #189 | | 3 | 43 first |
