# AI and Moderation: plan, decisions and tasks

Companion of `CLAUDE.md` (rules and contracts). This file changes often: decisions, current state, task list.

## 1. Decisions (all former open questions are closed)

The user does not want to wait for the team, so each question has a default decision. Everything is **additive and behind a feature flag**, so nothing breaks for other teammates, and teammates can review the small Tour change as a normal PR. If real code contradicts a decision, report it and adapt; do not guess.

| # | Question | Decision |
| --- | --- | --- |
| D1 | Event contract | Adopt the contract in `CLAUDE.md` section 4. Added keys are optional. The retired idea of `tour.ai_*` carrying only `tourId` stays valid: old consumers still work |
| D2 | Who emits `*.submitted` and when | Tour: when the author submits the tour (the existing publish/submit use-case) it sets status `ai_checking` and publishes `tour.submitted` with the content; when a place is created or its name/description/images change it publishes `place.submitted`. Both only when `MODERATION_EVENTS_ENABLED=true` (default false, old behaviour unchanged) |
| D3 | Who consumes results | Tour consumes `*.ai_passed` / `*.ai_rejected` in a queue of its own. Tour: `ai_passed` becomes `pending_review` (or `ai_warning` when `warning` is true); `ai_rejected` goes back to `draft` with the reasons stored. Place gets a moderation status (`checking`, `approved`, `warning`, `rejected`) plus reasons; Tour decides visibility from it. Notification may listen later (optional) |
| D4 | Who writes the Node part of Moderation | The user (AI owner): consumers, use-cases, AI reviewer, persistence, retry job. Admin queue and approve/reject (UC#19) are out of scope |
| D5 | Block tour submission while places are unchecked | Tour blocks submit if any place of the tour is `checking` or `rejected`. Places in `warning` do not block (the Admin sees them with the tour). Tour moderation itself never depends on this rule (it only uses data inside the event) |
| D6 | Phase 2 image URLs (Supabase Storage) | Assume the client uploads through the media service first, then submits places with public URLs, so the event is sent after the upload. Allowed hosts: `IMAGE_ALLOWED_HOSTS`, default derived from the Supabase host found in `services/media` config; signed URLs also work because the AI service only does a GET. Verify in `supabase-storage.js` |
| D7 | Place without a tour | Same flow: `place.submitted` with `tourId` null, result event sent back. Visibility rule stays in Tour. AI is unaffected |
| D8 | How AI is called | Follow the convention of the existing translation call (`ai-translator.js`, `translation.py`) for base URL (`http://ai:3004`) and JSON key naming; add `x-internal-token` only to `/moderate/*`. Do not change translation |
| D9 | Oversized text | Moderation truncates fields to the limits before calling AI, so a 422 should not happen for long text. Tour also enforces the same limits on input |
| D10 | Duplicate or repeated events | One row per `(subjectType, subjectId, revision)`. If a result already exists for that revision, Moderation re-publishes the stored result instead of calling AI again |
| D11 | Retry and failure | Moderation saves the case before calling AI, tries 3 times (2 s then 4 s) on timeout, 503, 429, network errors. 422 and other 4xx are permanent. After the last failure: status `ai_failed`, publish nothing, Tour keeps `ai_checking`. A sweeper retries `ai_failed` and stale `pending` cases (see #AI-29). Consumers acknowledge messages after saving the case, so a crash never loses work |
| D12 | Frameworks | No LangChain, LangGraph or LangSmith. Plain Python. Revisit only at the start of phase 3 (chatbot) if the course requires it |
| D13 | Quota | Moderation consumer prefetch 2 and a shared semaphore in AI keep within Gemini's 5 requests per minute; Groq absorbs overflow for text-only requests |

Moderation environment (add to the root `.env.example` in #AI-23): `AI_SERVICE_URL=http://ai:3004`, `AI_TIMEOUT_MS=45000`, `AI_MAX_ATTEMPTS=3`, `AI_RETRY_DELAY_MS=2000`, `INTERNAL_SERVICE_TOKEN`, `MODERATION_PREFETCH=2`, `RETRY_SWEEP_INTERVAL_MS=60000`, `RETRY_FAILED_AFTER_MS=300000`. Tour: `MODERATION_EVENTS_ENABLED=false`. Compose: `moderation` `depends_on: ai`.

## 2. Unverified assumptions (check before coding; the user could not paste these files)

1. `services/tour` has a submit/publish use-case (`publish-tour.js`, `publish-readiness.js`) and tour statuses that include `ai_checking`, `ai_warning`, `pending_review`. Read them and note the real names.
2. `services/notification` may already listen to some `tour.*` events (`notify.js`). Do not break it.
3. `shared/events/index.js` on `develop` may have changed since the old copy (`tour.submitted` = `{tourId, contributorId, at?}`, `tour.ai_passed` = `{tourId, at?}`, `tour.ai_rejected` = `{tourId, reason, at?}`).
4. How Prisma schemas are applied at startup (auth logs "database is already in sync", so probably `prisma db push` in the start script). Copy the way other services do it for Moderation's new table; the moderation database is the local Postgres, schema `moderation`.
5. Which Node test runner the services use (look at `package.json` and `services/auth/test`).
6. Moderation `src/index.js` currently only logs `tour.submitted` on queue `moderation.tour-submitted`; `container.js` is comments only and already names `aiReviewer`, `RunAiReview`, `eventBus`.

## 3. Current state

- Done and merged (or with PR): #AI-01 to #AI-10 (issues #5 to #14): spec v1, skeleton, config and `/health`, Gemini client, Groq client and fallback, schema, per-field text scan, `policy.py`, old `POST /moderate`, tests (26 passing). Confirm with `git log` and `git ls-files services/ai` (the tree may omit README, `.env.example`, `eval/`, `requirements-dev.txt`, `pytest.ini`).
- Reusable: `llm/*`, `policy.py`, `schema.py` (to extend), `FakeLLM` fixture. To replace: `moderation/service.py` (one call per field), old `POST /moderate`, `prompts/text_moderation.txt`.
- Branch `15-ai-11-add-rabbitmq-events-for-moderation` (issue #15) follows the abandoned design (AI listening to RabbitMQ). Do not use it and do not open a PR. Close #15 with the note "superseded by #AI-25 to #AI-29". Salvage only the idea of retry classification and the `Z` timestamp helper.
- Possibly created earlier by script (`create_ai_issues.sh`): #AI-19 to #AI-24 written for the old design. Run `gh issue list --label ai-service --state all --limit 60` and reconcile with section 4 (edit, retitle or close); never create duplicates.
- Whole stack runs locally (11 containers, `/health` OK). Root `.env`: SMTP and AWS empty, Gemini and Groq keys set.

## 4. Tasks

Codes #AI-xx are titles; GitHub issue numbers are assigned when issues are created. Order: AI track (19, 20, 21, 22, 12) can run without anyone else; contract and Moderation track (25, 26, 27, 28, 29); then 31, 23, 30; then phases 2 and 3. Each task is several small commits (prompt, logic, tests separate).

| Code | Branch | Scope | Acceptance Criteria (short) |
| --- | --- | --- | --- |
| #AI-19 | `docs/ai-service-spec-v2` | Rewrite `docs/02-design/ai-service-spec.md` as version 2.2 and add `docs/02-design/moderation-architecture.md` (diagram, responsibility table, both contracts, decisions D1 to D13); update `docs/02-design/README.md` | English; matches `CLAUDE.md`; lists feature flag and failure handling |
| #AI-20 | `feature/ai-place-moderation` | `schema.py` (place request, camelCase aliases, category `irrelevant`), `prompts/place_moderation.txt`, `place_service.py` (one call for name plus description), reuse `policy.py` and `FallbackLLM` | One LLM call per place; vi and en; blocked text becomes Reject/`other`; pytest with `FakeLLM` for each verdict and LLM failures |
| #AI-21 | `feature/ai-moderate-place-endpoint` | `POST /moderate/place` replacing `/moderate`, `pipeline.py` (30 s limit raising a timeout error), response shape from `CLAUDE.md` | 200, 422, 503; `imagesChecked` is 0; tests updated |
| #AI-22 | `feature/ai-tour-moderation` | `prompts/tour_moderation.txt`, `tour_service.py` (one text-only call: title, description, places names plus first 300 characters), `POST /moderate/tour`; remove `service.py`, old prompt and the unused `events/` package | One call per tour; description that contradicts its places is flagged; fields `title`/`description`/`coherence`; tests |
| #AI-12 | `feature/ai-auth-validator` | `middleware/auth.py` (`x-internal-token` on `/moderate/*`, 401), `validator.py` (length limits, prompt-injection hardening of delimiters), `INTERNAL_SERVICE_TOKEN` in config | 401 without or with a wrong token; `/health` and `/translate*` unaffected; tests |
| #AI-25 | `feature/events-moderation-contract` | `shared/events/index.js`: add `place.submitted`, extend `tour.submitted`, add `place.ai_passed`, `place.ai_rejected`, extend `tour.ai_passed` and `tour.ai_rejected` (all new keys optional, `at` with `Z`); a schema test | Old payloads still validate; new payloads validate; no other service breaks (run their tests) |
| #AI-26 | `feature/moderation-case-state` | `prisma/schema.prisma` model `ModerationResult` (id, subjectType, subjectId, revision, status, verdict, severity, reasons Json, attempts, model, checkedAt, createdAt; unique `(subjectType, subjectId, revision)`), repository, `case-state-machine.js`, `merge-verdicts.js` (worst verdict wins), ports | Pure-logic tests for state machine and merge; repository tested with a fake or in-memory port |
| #AI-27 | `feature/moderation-ai-reviewer` | `infrastructure/ai/http-ai-reviewer.js` (token, timeout, error classification), `infrastructure/retry/with-retry.js` (3 tries, 2 s then 4 s), truncation to limits (D9) | Tests with a fake HTTP server: 200, 422 permanent, 503 retried then fails, timeout |
| #AI-28 | `feature/moderation-event-flow` | `place-submitted-consumer.js`, `tour-submitted-consumer.js`, use-cases `run-place-review.js` and `run-tour-review.js`, `event-publisher.js` (zod check), wire `container.js` and `index.js`, idempotency (D10) | Fake AI and fake publisher: Pass, Warning (`warning:true`), Reject events; duplicate `revision` re-publishes; AI down leaves `ai_failed` and publishes nothing |
| #AI-29 | `feature/moderation-retry-job` | `retry-failed-cases.js` plus a timer started in `index.js` (D11) | Failed and stale cases are retried; successful retry publishes once; tests with a fake clock |
| #AI-31 | `feature/tour-moderation-integration` | **Small Tour change behind `MODERATION_EVENTS_ENABLED`** (default false): publish `tour.submitted` and `place.submitted` with content, set `ai_checking`; consume results (D3); block submit per D5; save reasons | Flag off = behaviour unchanged (existing tests pass); flag on = full round trip; keep the diff small so a teammate can review it |
| #AI-23 | `chore/ai-env-compose` | Root `.env.example` and compose: AI and Moderation variables, `depends_on: ai` for moderation, `INTERNAL_SERVICE_TOKEN` | No duplicated keys; `docker compose up` from a fresh copy works |
| #AI-30 | `test/moderation-e2e` | `tests/e2e/`: a script that plays the Tour side (publishes `place.submitted` and `tour.submitted`, waits for `*.ai_passed` / `*.ai_rejected`) against the running stack with a stub or real AI | Three scenarios (Pass, Warning, Reject) pass; documented in `docs/03-testing/` |
| #AI-24 | `feature/ai-place-images` | Phase 2: Gemini inline images, `images.py` (download, type and size checks, host allowlist), `images[n]` reasons, `imagesChecked`, Gemini only for places with images | Images analysed; a permanently unreadable image gives Warning; only allowed hosts fetched; mocked HTTP and LLM tests |
| #AI-13 to #AI-18 | see repo | Phase 3 chatbot: RAG over public tours and places (embedder, ingest, retriever), tools `search_tours` and `search_places`, agent with short-term memory, `POST /chat` (SSE) and `GET /chat/history`, eval, README; gateway `/api/chat` with rate limit. Reuse parts of the old `ai_service` project when the user provides it | Per the existing issues |

Roadmap: phase 1 (text moderation end to end) = #AI-19, 20, 21, 22, 12, 25, 26, 27, 28, 29, 31, 23, 30; phase 2 = #AI-24 (and optionally NSFW and turf.js signals in `merge-verdicts`); phase 3 = chatbot.

## 5. First session checklist

1. Read `CLAUDE.md` and this file. Run `git status --short`, `git log --oneline -15`, `git ls-files services/ai`, `gh issue list --label ai-service --state all --limit 60` (use the full path to `gh.exe` if `gh` is not on PATH).
2. Check the unverified assumptions in section 2 by reading the files, and write down the differences from the decisions.
3. Reconcile issues: write one idempotent shell script using `gh` (edit existing issues, create missing ones, close #15 as superseded). Issues in English with Description and Acceptance Criteria and label `ai-service`. Show the script to the user before running it.
4. Start with #AI-19, then #AI-20 and onward, one task per session.
