# Moderation end-to-end test

Task #AI-40 (issue #181). Script: `tests/e2e/moderation-e2e.mjs`.

## Purpose

The script plays the **Tour** side against the running stack. It publishes `place.submitted` and
`tour.submitted` on RabbitMQ (exchange `geosound.events`) and waits for the result events that Moderation
publishes: `place.ai_passed`, `place.ai_rejected`, `tour.ai_passed`, `tour.ai_rejected`. It checks the whole
path RabbitMQ → Moderation (case storage, geo rules, merge, retry classification) → AI HTTP contract → RabbitMQ.

By default the AI service is replaced by a deterministic **AI stub** (`tests/e2e/ai-stub/server.mjs`, no LLM,
no network). The stub implements the real contract (`POST /moderate/place`, `POST /moderate/tour`, snake_case,
header `x-internal-token`, 401 on a bad token) and answers from markers in the text:

| Marker in any text field | Stub answer |
| --- | --- |
| `E2E_REJECT` | `Reject`, severity 0.9, category `scam` |
| `E2E_WARN` | `Warning`, severity 0.5, category `misleading` |
| `E2E_422` | HTTP 422 (permanent input error) |
| none | `Pass`, severity 0, no reasons |

Place answers carry `images_checked` = number of images sent; tour answers have no `images_checked`.
`model` is `e2e-stub`. `GET /stats?id=<subject id>` returns how many times the stub was called for that id
(used by the duplicate scenario).

## Files

| File | Role |
| --- | --- |
| `tests/e2e/moderation-e2e.mjs` | The test script (Node 20, `amqplib`, `shared/events`) |
| `tests/e2e/ai-stub/server.mjs`, `Dockerfile` | AI stub (`node:20-alpine`, no dependencies) |
| `tests/e2e/docker-compose.e2e.yml` | Compose override: adds `ai-stub`, points Moderation at it, adds the one-shot `e2e` runner (profile `e2e`) |

The root `docker-compose.yml` is not changed.

## Prerequisites

- Docker Desktop, and the root `.env` in place (the normal stack setup). The test never reads or prints it.
- The stack is running, at least `rabbitmq` and `postgres` (`docker compose up -d`).
- The Moderation schema exists. The Moderation container runs `prisma db push` at start; check that the logs
  show `Your database is now in sync with your Prisma schema`:

  ```bash
  docker compose logs --tail 30 moderation
  ```

  If they show `db push skipped` (for example because of the old `moderation_logs` table), push it by hand.
  This only changes the local dev schema `moderation`:

  ```bash
  docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml exec -T moderation \
    npx prisma db push --accept-data-loss --skip-generate
  ```

## Run (from the repo root)

1. Start the stub and restart Moderation against it:

   ```bash
   docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml up -d --build ai-stub moderation
   ```

   Add `--no-deps` when the rest of the stack is already running. Moderation then uses
   `AI_SERVICE_URL=http://ai-stub:3004` and `INTERNAL_SERVICE_TOKEN=e2e-internal-token` (a test-only value).

2. Run the script. The `e2e` service reuses the Moderation image (it already has `amqplib`, `zod` and
   `shared/`), mounts `tests/e2e` read-only and reads `RABBITMQ_URL` from `.env` inside the container:

   ```bash
   docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml --profile e2e run --rm --build --no-deps e2e
   ```

   The exit code is 0 when every scenario passes, 1 otherwise.

   Alternative from the host (no idempotency call count, because the stub port is not published):

   ```bash
   npm install                                   # once, at the repo root (workspaces install amqplib and zod); do not commit the root package-lock.json it rewrites
   RABBITMQ_URL=amqp://guest:guest@localhost:5672 node tests/e2e/moderation-e2e.mjs
   ```

Environment of the script: `RABBITMQ_URL` (default `amqp://guest:guest@localhost:5672`, never printed),
`RABBITMQ_EXCHANGE` (default `geosound.events`), `E2E_TIMEOUT_MS` (default 60000 per result),
`E2E_AI_STUB_URL` (set to `http://ai-stub:3004` by the `e2e` service; enables the "AI called once" check).

## Scenarios

Each scenario uses unique ids (`e2e-<run>-<name>`) and `revision = new Date().toISOString()`. Every published
payload is validated with `validateEvent` from `shared/events` before it is sent, and every result is validated
again on receipt. A result is matched by id **and** revision. Scenarios run one after another.

| # | Scenario | Input | Expected result |
| --- | --- | --- | --- |
| 1 | place Pass | clean text | `place.ai_passed`, no `warning`, no reasons |
| 2 | place Pass with 2 images | clean text, 2 image URLs (not fetched by the stub) | `place.ai_passed`, no `warning` (stub checked 2 of 2 images) |
| 3 | place Warning | description has `E2E_WARN` | `place.ai_passed`, `warning: true`, reason `source: ai`, `category: misleading` |
| 4 | place Reject | description has `E2E_REJECT` | `place.ai_rejected`, non-empty `reason`, reason `ai:scam` |
| 5 | place AI 422 | description has `E2E_422` | `place.ai_passed`, `warning: true`, reason `ai:other` (human review) |
| 6 | tour Pass | walking tour, 2 stops 500 m apart, clean text | `tour.ai_passed`, no `warning` |
| 7 | tour geo Warning | walking tour, 2 stops about 10 km apart (G3 long leg), clean text | `tour.ai_passed`, `warning: true`, reason `source: geo`, `category: route` |
| 8 | tour content Reject | title has `E2E_REJECT` | `tour.ai_rejected`, reason `ai:scam` |
| 9 | place duplicate revision | the same `place.submitted` published twice | two identical results; the stub was called once |

## Expected output

Run on 2026-10-27 against `develop` (b8a549c) with the stub:

```text
[e2e] run e2e-mvqnw5yd, exchange geosound.events, timeout 60000 ms per result
| # | Scenario                     | Result | Time   | Detail                                          |
|---|------------------------------|--------|--------|-------------------------------------------------|
| 1 | place Pass                   | PASS   | 151 ms | place.ai_passed sev=0 []                        |
| 2 | place Pass with 2 images     | PASS   | 49 ms  | place.ai_passed sev=0 []                        |
| 3 | place Warning                | PASS   | 17 ms  | place.ai_passed warning sev=0.5 [ai:misleading] |
| 4 | place Reject                 | PASS   | 51 ms  | place.ai_rejected sev=- [ai:scam]               |
| 5 | place AI 422 -> Warning      | PASS   | 17 ms  | place.ai_passed warning sev=0.5 [ai:other]      |
| 6 | tour Pass                    | PASS   | 46 ms  | tour.ai_passed sev=0 []                         |
| 7 | tour geo Warning (10 km leg) | PASS   | 13 ms  | tour.ai_passed warning sev=0.5 [geo:route]      |
| 8 | tour content Reject          | PASS   | 47 ms  | tour.ai_rejected sev=- [ai:scam]                |
| 9 | place duplicate revision     | PASS   | 110 ms | 2 x place.ai_passed, AI calls=1                 |
[e2e] 9/9 PASS
```

`sev=-` means the event has no `severity` key (`*.ai_rejected` does not carry one). Notification logs
`tour.ai_rejected thiếu contributorEmail` ("missing contributorEmail") for scenario 8: expected, the test contributor
has no account in Auth, so the email lookup (#258) finds nobody.

## Restore the normal stack

Restart Moderation without the override (it goes back to `AI_SERVICE_URL` and the token from `.env`) and
remove the stub:

```bash
docker compose up -d --build moderation
docker compose -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml rm -sf ai-stub
```

Without the second command, later `docker compose up` calls warn about an orphan `ai-stub` container.
Moderation cases created by the test stay in the local `moderation` schema; their ids start with `e2e-`.

## Real AI run (manual, only on request)

Only run this when the owner asks: it spends Gemini quota (free tier, 5 requests per minute).

1. Use the normal stack (no override), so Moderation calls the real AI service (`http://ai:3004`) with the
   token from `.env`.
2. Run the script from the host (see the alternative above), optionally with a longer `E2E_TIMEOUT_MS`
   (Moderation retries 429 / 503 up to 3 times; after that the case is `ai_failed` and the sweeper retries it
   every 60 s).

The markers mean nothing to the real model, so the verdicts depend on Gemini: scenarios 3, 4, 5, 8 and the
Pass scenarios may give other verdicts, the 422 scenario does not apply, and scenario 2 depends on whether the
image URLs can be fetched. Only the geo Warning (scenario 7) is deterministic, because the geo rules run in
Moderation. Treat this run as a smoke test and read the `Detail` column; never print the key.
