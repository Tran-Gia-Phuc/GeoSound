# AI Service Specification

Version: 3.0 | Date: 2026-10-27 | Owner: AI service

This is the specification of the AI service (`services/ai`, Python 3.11, FastAPI, port 3004). It follows the
system design in [AI and Moderation Architecture (V4)](moderation-architecture.md). If the two disagree, the
architecture document wins and this spec must be fixed.

## 1. Purpose and scope

The AI service is a stateless judge called over HTTP by the Moderation service (Node, port 3003). It validates
input, builds one prompt, calls the LLM and applies a deterministic policy. It stores no moderation state.

| In scope | Phase |
| --- | --- |
| Place moderation: text (name, description) of one place | 1 |
| Place moderation: images of one place (same Gemini call) | 2 |
| Tour content moderation: title, description, coherence with its places | 1 |
| Travel chatbot over public tours and places | 3 |

| Out of scope | Owner |
| --- | --- |
| Geo rules on tour routes (distances, spread, duration) | Moderation (`domain/geo/tour-geo-rules.js`) |
| Forbidden-zone checks | Tour (`add-place.js`) |
| Admin approval queue and decisions (UC#19) | Another teammate |
| Translation (`app/translation`, `api/translation.py`) | Another teammate |
| RabbitMQ: consuming `*.submitted`, publishing results, retries, case state | Moderation. The AI service does not consume moderation events |

## 2. Moderation rules

### 2.1 Verdicts

| Verdict | Meaning | What Moderation publishes |
| --- | --- | --- |
| `Pass` | Nothing relevant found | `*.ai_passed` |
| `Warning` | Borderline content, a human should look | `*.ai_passed` with `warning: true` and reasons |
| `Reject` | Severe violation | `*.ai_rejected` with reasons |

The AI service never publishes anything and never changes tour or place visibility. Tour decides state.

### 2.2 Categories

| Category | Meaning |
| --- | --- |
| `hate` | Hate or discrimination |
| `violence` | Violence or threats |
| `sexual` | Sexual content |
| `scam` | Scam, spam, advertising |
| `misleading` | False or misleading information |
| `irrelevant` | Not travel content |
| `other` | Anything else, including provider-blocked content |

The category `route` exists in V4 reasons but is produced only by Moderation's geo rules, never by the AI service.

### 2.3 Policy (`moderation/policy.py`)

The LLM only reports findings (`category`, `severity` 0 to 1). The policy decides the verdict from the highest
severity.

| Condition | Verdict | Variable (default) |
| --- | --- | --- |
| `severity >= 0.8` | Reject | `MODERATION_REJECT_THRESHOLD` (0.8) |
| `severity >= 0.4` | Warning | `MODERATION_WARNING_THRESHOLD` (0.4) |
| otherwise | Pass | |

- Any doubt goes to a human (Warning), never to an automatic Pass.
- Text blocked by the provider (`LLMBlockedError`) is a **Reject** with category `other`, not an infrastructure
  error.
- One LLM call per place and one per tour. A tour scan does not rescan its places; it reads place names and short
  descriptions only to judge coherence.

### 2.4 Providers

| Rule | Detail |
| --- | --- |
| Primary | Gemini (`GEMINI_MODEL`, currently `gemini-2.5-flash`) |
| Fallback | Groq, only on timeout, 429 or 5xx, and only for text-only requests |
| Never fall back | 4xx other than 429, blocked content, any request with images (phase 2) |
| Images | Gemini only. A place is never Passed with unchecked images: an image that permanently cannot be read gives a Warning with field `images[n]` |
| Rate limit | Gemini free tier is 5 requests per minute; Moderation's prefetch and a semaphore in AI protect it |

## 3. REST contract

All moderation endpoints require header `x-internal-token` equal to `INTERNAL_SERVICE_TOKEN`. JSON on the wire is
**snake_case**, same as `/translate`. Events stay camelCase; Moderation converts names only in
`application/dtos/ai-mapping.js`. The old `POST /moderate` (with `stops` / `stop_id`) is replaced by the two
endpoints below.

### 3.1 `POST /moderate/place`

| Field | Type | Required | Limit |
| --- | --- | --- | --- |
| `place_id` | string | yes | |
| `tour_id` | string | yes | |
| `name` | string | yes | 200 |
| `type` | string | no | |
| `description` | string | yes | 2000 |
| `language` | `vi` or `en` | yes | |
| `city` | string | no | |
| `images` | `[{url, caption?}]` | no | 5 images (checked in phase 2) |

Request:

```json
{
  "place_id": "p1",
  "tour_id": "t1",
  "name": "Ben Thanh Market",
  "type": "market",
  "description": "Historic market in District 1, open from 6 am.",
  "language": "en",
  "city": "Ho Chi Minh City",
  "images": [{ "url": "https://<storage-host>/storage/v1/object/public/<bucket>/<key>", "caption": "Main gate" }]
}
```

Response `200`:

```json
{
  "place_id": "p1",
  "verdict": "Warning",
  "severity": 0.55,
  "reasons": [
    { "field": "description", "category": "misleading", "message": "The opening hours look incorrect." }
  ],
  "images_checked": 0,
  "model": "gemini-2.5-flash"
}
```

`field` is `name`, `description` or `images[n]`. `images_checked` is 0 in phase 1.

### 3.2 `POST /moderate/tour`

| Field | Type | Required | Limit |
| --- | --- | --- | --- |
| `tour_id` | string | yes | |
| `title` | string | yes | 200 |
| `description` | string | yes | 5000 |
| `language` | `vi` or `en` | yes | |
| `city` | string | no | |
| `type` | string | no | |
| `duration_minutes` | integer | no | |
| `places` | `[{place_id, name, type?, description}]` | yes | 50 places; AI cuts each `description` to 300 characters |

Request:

```json
{
  "tour_id": "t1",
  "title": "Saigon street food walk",
  "description": "A two-hour walk through the best food stalls of District 1.",
  "language": "en",
  "city": "Ho Chi Minh City",
  "type": "walking",
  "duration_minutes": 120,
  "places": [
    { "place_id": "p1", "name": "Ben Thanh Market", "type": "market", "description": "Historic market..." },
    { "place_id": "p2", "name": "Nguyen Hue Street", "description": "Pedestrian street..." }
  ]
}
```

Response `200`:

```json
{
  "tour_id": "t1",
  "verdict": "Pass",
  "severity": 0.1,
  "reasons": [],
  "model": "gemini-2.5-flash"
}
```

`field` is `title`, `description` or `coherence`. There is no `images_checked` in the tour response.

### 3.3 Common rules

| Item | Rule |
| --- | --- |
| `message` | Short sentence in the request `language` (`vi` or `en`) |
| `severity` | Highest finding severity, 0 to 1 |
| `model` | Model that produced the answer (Gemini or Groq model name) |

| Status | Meaning | Moderation action |
| --- | --- | --- |
| `200` | Verdict returned | Save and publish |
| `401` | Missing or bad `x-internal-token` | Configuration error: case `ai_failed`, nothing published, sweeper retries after the token is fixed |
| `422` | Invalid input (schema, limits, image rules) | Permanent, do not retry: publish a Warning for human review |
| `503` | Temporary failure: all providers failed, timeout or malformed model output (no provider details in the body) | Temporary, retry |

### 3.4 Image rules (phase 2)

| Rule | Value |
| --- | --- |
| Count | At most 5 per place |
| Size | At most 3 MB each |
| Format | jpeg, png, webp |
| Scheme | https only |
| Host | Must be in `IMAGE_ALLOWED_HOSTS` (the storage host) |
| Redirects | Not followed |

## 4. Configuration

Names only; values live in the root `.env`, which is never committed.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini key (secret) |
| `GEMINI_MODEL` | Gemini model name |
| `GROQ_API_KEY` | Groq key (secret) |
| `GROQ_MODEL` | Groq model name |
| `LLM_TIMEOUT_SECONDS` | Timeout of one provider call |
| `MODERATION_REJECT_THRESHOLD` | Reject threshold (default 0.8) |
| `MODERATION_WARNING_THRESHOLD` | Warning threshold (default 0.4) |
| `MODERATION_TIMEOUT_SECONDS` | Total time budget of one moderation request, including the wait for a slot |
| `MODERATION_MAX_CONCURRENCY` | Moderation LLM calls running at the same time (quota, default 2) |
| `INTERNAL_SERVICE_TOKEN` | Shared token checked on `/moderate/*` (secret) |
| `IMAGE_ALLOWED_HOSTS` | Comma-separated hosts allowed for images (phase 2) |
| `LANGSMITH_TRACING` | Enables LangSmith tracing, `false` by default |

## 5. Observability

Structured logs carry the subject id, model, latency and verdict, never content secrets or keys. Optional
LangSmith tracing (`langsmith` package, `@traceable`) can be turned on with `LANGSMITH_TRACING=true` to inspect
prompts, latency and token usage. It is off by default and never enabled in tests.

## 6. Security

- `/moderate/*` rejects requests without a valid `x-internal-token` (401).
- User text is placed inside clear delimiters in the prompt and treated as data, never as instructions
  (prompt-injection defence). Input is length-limited by the validator before the LLM call.
- Keys and tokens come from environment variables only and are never logged or returned.

## 7. Testing

- Tests never call real LLMs or the network.
- Use `FakeLLM` (`services/ai/tests/conftest.py`) for provider behaviour, including blocked content, timeouts,
  429 and 5xx to check fallback rules.
- Use `httpx.MockTransport` for HTTP clients and image fetching.
- Policy thresholds, validator limits and the 401 / 422 / 503 paths are covered by unit tests.

## 8. Chatbot (phase 3)

The chatbot uses LangGraph (agent graph and memory), LangChain (model wrappers, tools, prompts) and LangSmith
(tracing and evaluation) with graph plus vector RAG over public tours and places only. See section 8 of the
[architecture document](moderation-architecture.md). Endpoints, storage and data ingestion are decided in #AI-43.

## 9. Changes from v1.0

- AI no longer consumes `tour.submitted` or publishes results; Moderation owns RabbitMQ, retries and state.
- AI no longer loads tour content from Tour; content arrives in the event and then in the HTTP request.
- `POST /moderate` with `stops` / `stop_id` is replaced by `POST /moderate/place` and `POST /moderate/tour`.
- Auth is `x-internal-token` (service token) instead of a user JWT.
- Places are moderated on their own (text, then images in phase 2); a tour scan does not rescan places.
- Image moderation moves from client-side only to Gemini in phase 2.
- Added `irrelevant` and `other` categories, explicit thresholds and the `LLMBlockedError` rule.
- Response adds `severity` and `model`; place response adds `images_checked`.
- Geo checks are done by Moderation, not by AI.
- Chatbot design now follows the V4 architecture (LangGraph, graph RAG).
