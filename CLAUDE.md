# GeoSound: AI and Moderation (agent instructions)

Read this file first in every session, then read `AI_PLAN.md` (decisions, current state, task list, notes for the next tasks). One task per branch, in the order of `AI_PLAN.md` section 4. Several tasks in one session only when the user asks for it. **Run tasks with the project skill `/ai-task <N>`** (`.claude/skills/ai-task/SKILL.md`): it holds the full branch → agent → test → review → commit → PR → merge procedure.

**Priority:** phases 1, 2 and 3 (place moderation, tour moderation, chatbot), the Tour side (#180, #240), the gateway chat route (#188) and UC#19 admin review (#243) are merged and checked on the real stack. Next work only on request: the follow-ups in `AI_PLAN.md` section 5, real-model eval baseline, smaller AI image.

## 1. Role and language

You help one student (owner of the **AI** part) on the team project GeoSound. Reply to the user in **Vietnamese**, short and concrete. Write code, comments, commit messages, issues and everything under `docs/` in **English**.

The user owns: place moderation, tour moderation, chatbot (`services/ai`), plus the AI-related parts of `services/moderation` (consumers, use-cases, AI reviewer, persistence). Admin approval (UC#19, backend in `services/tour`, issue #243) and signed-in devices (UC23: `services/auth`, `shared/middleware` `verifyJwt`, Notification alert, client screen; issues #247, #248) were handed over to the user on 2026-10-30; the UC19 admin screens stay with Frontend A. `services/ai/app/translation` and `api/translation.py` were added by another teammate: do not change them.

## 2. Architecture (V4, accepted: `docs/02-design/moderation-architecture.md`)

```text
Tour ──place.submitted / tour.submitted (content inside)──▶ RabbitMQ ──▶ Moderation (Node)
Moderation ──HTTP POST /moderate/place | /moderate/tour (x-internal-token)──▶ AI (Python) ──▶ Gemini (fallback Groq)
Moderation: save case, geo rules (tour), merge signals, retry
Moderation ──place.ai_passed | place.ai_rejected | tour.ai_passed | tour.ai_rejected──▶ RabbitMQ ──▶ Tour
Warning = ai_passed with warning:true and reasons. Temporary AI failure = publish nothing; 422 = Warning for human review.
```

- **AI service** (`services/ai`, Python 3.11, FastAPI, port 3004): stateless HTTP. It does **not** listen to RabbitMQ, with one exception: the chatbot indexer consumes `tour.published` / `tour.unpublished` (D21). Also hosts translation and the chatbot.
- **Moderation** (`services/moderation`, Node, port 3003): listens to events, calls AI over HTTP, owns retry, state and results, publishes results. Never calls an LLM itself.
- **Tour** (`services/tour`): owns tour/place state and visibility. Publishes `*.submitted`, consumes `*.ai_passed` / `*.ai_rejected`. Never calls AI for moderation.
- Moderation and AI only use data carried by the events. They never read other services' databases or call their APIs.
- A Pass is sent to Tour, which decides state and visibility. Moderation never touches the map.

## 3. Business rules

- One LLM call per place and one per tour (Gemini free tier = 5 requests per minute). A tour scan does **not** rescan its places.
- The LLM only reports findings (`category`, `severity` 0 to 1). `policy.py` decides: `severity >= 0.8` Reject, `>= 0.4` Warning, else Pass (`MODERATION_REJECT_THRESHOLD`, `MODERATION_WARNING_THRESHOLD`). Any doubt goes to a human, never to an automatic Pass.
- Categories: `hate, violence, sexual, scam, misleading, irrelevant, other` (from AI), plus `route` (from Moderation geo rules).
- Tour geo rules G1 to G6 run in Moderation (`domain/geo/tour-geo-rules.js`, pure JS, no LLM, limits per tour `type`). Only G1 (invalid coordinate) rejects; the rest are Warnings. Geo findings and the AI verdict are merged: worst verdict wins, max severity, reasons carry `source: ai | geo`. Forbidden zones are checked by Tour, not here.
- A permanent AI error (422) is published as a Warning for human review. A temporary failure after retries, or a 401 (configuration error), publishes nothing (`ai_failed`, sweeper retries).
- Text blocked by the provider (`LLMBlockedError`) is a **Reject** with category `other`, not an infrastructure error.
- Fallback to Groq only on timeout, 429, 5xx, and only for text-only requests. 4xx and blocked content are never retried on another provider.
- Phase 1 = text only (`imagesChecked` is 0). Phase 2 = place images (Gemini only; never Pass a place whose images were not checked). Phase 3 = chatbot.

## 4. Contracts

**Events** (`shared/events/index.js`, zod, one topic exchange `geosound.events`, routing key = event name, camelCase). `at` uses `z.string().datetime()`: it **must end with `Z`**. The shared `consume()` nacks without requeue when a handler throws, so a handler must never throw for work it wants to retry.

| Event | Direction | Payload |
| --- | --- | --- |
| `place.submitted` | Tour → Moderation | `placeId`, `tourId`, `contributorId`, `revision`, `name`, `type?`, `description`, `language`, `lat`, `lng`, `city?`, `images?[{url, caption?}]` (max 5), `at?` |
| `tour.submitted` | Tour → Moderation | existing `tourId`, `contributorId`, `at?` plus optional `revision`, `title`, `description`, `language`, `city`, `type`, `durationMinutes`, `places[{placeId, name, type?, description, lat, lng, sequence}]` (max 50) |
| `place.ai_passed`, `tour.ai_passed` | Moderation → Tour | id (`placeId` + `tourId`, or `tourId`), `revision`, optional `warning`, `severity`, `reasons[]` |
| `place.ai_rejected`, `tour.ai_rejected` | Moderation → Tour | id, `revision`, `reason` (string, reasons joined, max 1000), optional `reasons[]` |

`Reason` = `{ field, category, message, source: 'ai' | 'geo', severity? }`. Full contract: `docs/02-design/moderation-architecture.md` section 6.

`revision` is set by Tour (its `updatedAt`) and echoed back; Tour ignores a result whose revision is stale. All new keys are optional or additive so existing consumers keep working.

**HTTP** (Moderation → AI): header `x-internal-token` = `INTERNAL_SERVICE_TOKEN`, JSON **snake_case** on the wire, same as `/translate` (decision D8; verified against `translation.py`, `schema.py`, `ai-translator.js`). Events stay camelCase. Moderation converts naming in one place only: `services/moderation/src/application/dtos/ai-mapping.js`.

```json
// POST /moderate/place  ->  200
{ "place_id": "p1", "verdict": "Warning", "severity": 0.55,
  "reasons": [{ "field": "description", "category": "misleading", "message": "..." }],
  "images_checked": 0, "model": "gemini-2.5-flash" }
```

`POST /moderate/place` takes `place_id`, `tour_id`, `name`, `type?`, `description`, `language`, `city?`, `images?[{url, caption?}]`. `POST /moderate/tour` takes `tour_id`, `title`, `description`, `language`, `city?`, `type?`, `duration_minutes?`, `places[{place_id, name, type?, description}]` (the old `stops` / `stop_id` of `POST /moderate` are replaced) and returns the same shape with `tour_id` and without `images_checked`; `field` is `title`, `description` or `coherence`. Errors: 401 bad token, 422 invalid input (permanent, do not retry), 503 all providers failed (temporary, retry). `message` is a short sentence in the request `language` (`vi` or `en`).

Limits: title 200, tour description 5000, place name 200, place description 2000, at most 50 places per tour (AI cuts each place description to 300 characters for the tour scan), at most 5 images (phase 2: 3 MB each, jpeg/png/webp, allowed hosts only, https only, no redirects).

## 5. Git rules (the teacher reads the history)

- Branch from `develop`; never commit to `main`, `staging` or `develop`. One branch, one purpose. Create it from the issue: `gh issue develop <N> --base develop --name <name> --checkout`.
- Small commits, "one commit, one change", format `<type>: <short description>` with `feat, docs, fix, chore, test, refactor`.
- **Never `git add .` or `git add -A`.** Add explicit paths. Untracked files `CNPM-main/`, `PROJECT_TREE.md`, `package-lock.json` at the repo root are not ours: never add them.
- Do not push, open a PR or merge unless the user says so. Before asking to push, show `git log --oneline` of the branch. PR: `gh pr create --base develop --fill --body "Closes #<N>"`; merge with "Create a merge commit" (no squash, no `--admin`).
- Merge only when no CI check fails. The `Client — browser smoke tests` job (`player-controls.spec.js`) is known to be flaky: rerun the failed job and merge when green. After a merge, check the issue is CLOSED (else close it with "Done in PR #<PR>").
- Docs go under `docs/` in the right phase folder with a `README.md` index; never delete old docs.

## 6. Safety

- Never read, print, log or commit `.env` or any API key (`GEMINI_API_KEY`, `GROQ_API_KEY`, Supabase URLs). To check config, list key names only: `cut -d= -f1 .env`.
- Tests never call real LLMs or the network: use `FakeLLM` (`services/ai/tests/conftest.py`) and `httpx.MockTransport` in Python; a fake `fetch` or small local server in Node.
- Real-LLM smoke runs are allowed only when the user asks, and print results without the key. Gemini free tier is rate limited (429, 503 happen); this key works only with `gemini-2.5-flash`.
- Do not change files owned by other services unless the task says so. Changes there stay behind a feature flag and are merged by their owner, unless the owner handed the task over (the Tour owner did for #180 and #240). Never push schema changes or test data to another service's Supabase schema without the user's explicit go-ahead; test on a disposable Postgres instead.

## 7. Commands

The host has no `node_modules` or Python deps: tests run in throwaway containers from the built images. The exact commands (AI pytest, Node tests in the image and repo layouts, Prisma validate) are in `.claude/agents/test-runner.md` and `.claude/skills/ai-task/SKILL.md` step 3; the e2e with the AI stub is in `docs/03-testing/moderation-e2e.md`.

- Whole stack: `docker compose up -d --build` (needs the root `.env`, which you must not read). Add `--build` after changing `requirements.txt` or `package.json`.
- Compose check: `docker compose -f docker-compose.yml config -q`; never run `config` without `-q` (it prints secrets).
- Logs: `docker compose logs --tail 30 <service>`. Use `git --no-pager`. The root `.env` must have no duplicated keys.

**CI rule for Node services:** CI runs `npm test` from the repo layout, where `services/<svc>/../shared` does not exist. Only `src/index.js` may import `../shared/...`; everything else gets `validateEvent` / `publish` injected, and test helpers load shared with a dynamic import (repo path first, then image path).

## 8. How to work on a task

1. Read `AI_PLAN.md`, then the issue (`gh issue view <N>`) and the code you will touch. Verify the "unverified assumptions" that apply to the task and say what you found.
2. Create the branch from the issue. Implement in small commits, tests with the code.
3. Run the relevant tests; run the real stack only when the task needs it.
4. Definition of done: all Acceptance Criteria of the issue met, tests pass, no secrets, no unrelated files in `git status`, commit messages follow the format. Then show the log and wait for the user.
5. If something in this file or `AI_PLAN.md` conflicts with the real code, stop and tell the user instead of guessing.

## 9. Layout of the AI and Moderation code

Do not move files.

```text
services/ai/app/
  api/            moderation.py (POST /moderate/place, /moderate/tour), translation.py (not ours)
  moderation/     schema.py policy.py place_service.py tour_service.py pipeline.py
                  validator.py images.py, tracing.py (LangSmith, optional, #AI-32),
                  prompts/{place,tour}_moderation.txt
  chatbot/        agent.py models.py graph/{builder,rules,state}.py tools/search.py
                  rag/{models,chunker,embedder,graph_builder,store,indexer,consumer,retriever,hybrid_retriever}.py
  middleware/     auth.py (x-internal-token)
services/moderation/src/
  config.js  container.js  index.js
  domain/         entities, errors, ports, moderation/{case-state-machine,merge-verdicts}.js,
                  geo/{distance,tour-geo-rules}.js (pure JS)
  application/    events.js, dtos/ai-mapping.js,
                  use-cases/{review-case-flow,run-place-review,run-tour-review,retry-failed-cases}.js
  infrastructure/ ai/http-ai-reviewer.js, retry/with-retry.js, persistence/*, messaging/event-publisher.js
  interfaces/     events/{place,tour}-submitted-consumer.js, jobs/retry-sweeper.js
```

Dependency direction in Moderation: `interfaces -> application -> domain`; `infrastructure` implements domain ports; only `container.js` wires them.

## 10. Sub-agents (`.claude/agents/`)

The main agent owns git, the issue, and the final answer to the user. Delegate work, not responsibility. Sub-agents never run git write commands.

| Agent | Use for |
| --- | --- |
| `ai-python-dev` | code under `services/ai` (not translation) |
| `moderation-node-dev` | code under `services/moderation` |
| `test-runner` | run pytest / `node --test` and report |
| `contract-reviewer` | read-only review of events, HTTP contract, secrets, git hygiene, before asking the user to push |
| `docs-writer` | English docs under `docs/` |

Typical task (automated by `/ai-task`): dev agent implements (code plus tests) -> `test-runner` -> `contract-reviewer` (fix every FAIL, review again) -> main agent commits, shows `git log --oneline` and waits for the user (or pushes and merges when the user allowed it for that run). Independent tasks run in parallel in git worktrees (`/e/CNPM/git/wt-<N>`).

If `ai-python-dev` or `moderation-node-dev` is not available in the session, use `general-purpose` and paste the rules from the matching `.claude/agents/*.md` file into its prompt.

**Token budget for sub-agents:** name the exact files and doc sections to read; never ask an agent to read a whole design doc (`chatbot-architecture.md` and `moderation-architecture.md` are 300+ lines). `test-runner` runs each suite once (twice only for timing-sensitive tests). A re-review checks only the previous FAIL items. Resume a stopped agent with SendMessage instead of starting a new one.
