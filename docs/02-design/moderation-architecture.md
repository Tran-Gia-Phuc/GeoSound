# AI and Moderation Architecture

Status: **accepted (V4)**, 2026-10-27. Owner: AI part of GeoSound.
Replaces the V3 notes in `AI_PLAN.md` once accepted. Older issues #AI-11 to #AI-24 follow the abandoned
design and are superseded by the task list in section 10.

## 1. Scope

| # | Feature | Trigger | Output | Phase |
| --- | --- | --- | --- | --- |
| F1 | **Place moderation**: text (name, description) and images of one new or edited place | Tour publishes `place.submitted` | `place.ai_passed` / `place.ai_rejected` back to Tour | 1 (text), 2 (images) |
| F2 | **Tour moderation**: tour content (title, description, coherence with its places) and route geometry (distances, spread, duration). Places are **not** moderated again | Tour publishes `tour.submitted` | `tour.ai_passed` / `tour.ai_rejected` back to Tour | 1 |
| F3 | **Travel chatbot**: answers questions about public tours and places, using graph plus vector RAG | Client `POST /api/chat` | Streamed answer with cited tours and places | 3 (later) |

Out of scope: Admin approval queue and decisions (UC#19, another teammate), translation (another teammate),
forbidden-zone checks (already done synchronously by Tour in `add-place.js`).

## 2. What the real code says (checked on `develop`)

| Fact | Where | Consequence |
| --- | --- | --- |
| `Place.tourId` is required | `services/tour/prisma/schema.prisma` | Every place belongs to a tour; `tourId` is required in `place.submitted` (old decision D7 is dropped) |
| Place has `lat`, `lng`, `type`, `sequence`, `images [{url, caption}]` | same | Geo rules can run on data carried by the event |
| Tour has `type` (`walking`, `driving`, `cycling`, `indoor`), `duration` (minutes), `city` | `tour.js`, schema | Distance limits depend on `type` |
| Forbidden zones are checked by Tour when a place is added | `add-place.js`, `polygon-zone-checker.js` | Moderation does not repeat it |
| `PublishTour` publishes directly (team decision: no moderation yet); statuses `ai_checking`, `ai_warning`, `pending_review` already exist | `publish-tour.js`, `tour.js` | Tour integration switches publish to "submit" behind a feature flag |
| Place has no moderation status column | schema | Tour integration adds `moderationStatus` and `moderationReasons` (migration) |
| `shared/events`: `tour.submitted {tourId, contributorId}`, `tour.ai_passed {tourId}`, `tour.ai_rejected {tourId, reason, recipient?}`; no `place.*` | `shared/events/index.js` | All new keys must be optional so Notification keeps working |
| Notification consumes `tour.ai_rejected` | `services/notification/src/index.js` | Keep `reason` as a string |
| Haversine already exists in Tour | `services/tour/src/domain/geo/distance.js` | Moderation keeps its own copy (services do not import each other) |
| Images live in Supabase Storage, public URL `{url}/storage/v1/object/public/{bucket}/{key}` | `services/media/.../supabase-storage.js` | Image host allowlist = the Supabase host |
| Postgres image is `postgis/postgis:16-3.4` (no pgvector) | `docker-compose.yml` | Chatbot vector store needs a decision (section 8.4) |

## 3. System layout

```text
                        ┌────────────────────────── RabbitMQ (topic exchange geosound.events) ─────────────────────────┐
                        │                                                                                               │
 Client ─▶ Gateway ─▶ Tour ── place.submitted / tour.submitted ──▶ queue moderation.* ──▶ Moderation (Node, :3003)      │
                        ▲                                                                   │  1. save case (Postgres,  │
                        │                                                                   │     schema moderation)    │
                        │                                                                   │  2. geo rules (tour only) │
                        │                                                                   │  3. POST /moderate/*  ────┼──▶ AI (Python, :3004)
                        │                                                                   │     x-internal-token      │      validator → prompt →
                        │                                                                   │  4. merge signals         │      Gemini (fallback Groq)
                        │                                                                   │  5. publish result        │      → policy.py
 Tour ◀── queue tour.moderation-results ◀── place.ai_passed|ai_rejected, tour.ai_passed|ai_rejected ◀────┘           │
   │  sets status, stores reasons, decides visibility                                                                  │
   └──▶ (pending_review) ──▶ Admin approval (UC#19, not ours)                                                          │
                                                                                                                       │
 Client ─▶ Gateway /api/chat ─▶ AI chatbot (phase 3): LangGraph agent ─▶ graph + vector retriever ─▶ Gemini           │
```

Responsibilities:

| Service | Does | Never does |
| --- | --- | --- |
| **Tour** | Owns tours, places, statuses, visibility. Publishes `*.submitted` with the content. Consumes results. Blocks tour submission while a place is `checking` or `rejected` | Call AI for moderation |
| **Moderation** (Node) | Consumes `*.submitted`, stores a case per `(subject, revision)`, runs deterministic geo rules, calls AI over HTTP, retries, merges signals, publishes results | Call an LLM, read Tour's DB, touch visibility |
| **AI** (Python) | Stateless judge: validates input, builds one prompt, calls the LLM, applies `policy.py`. Later hosts the chatbot | Listen to RabbitMQ for moderation, store moderation state |

Why the split: one place owns retries and state (Moderation), the LLM part stays stateless and easy to test, and
the AI service's rate limit (Gemini free tier, 5 requests per minute) is protected by Moderation's prefetch.

## 4. Flow F1: place moderation

```mermaid
sequenceDiagram
  participant T as Tour
  participant Q as RabbitMQ
  participant M as Moderation
  participant A as AI
  T->>T: place created/edited, moderationStatus=checking
  T->>Q: place.submitted (content, lat/lng, images, revision)
  Q->>M: deliver
  M->>M: upsert case (place, placeId, revision); if result exists re-publish it
  M->>A: POST /moderate/place (truncated fields)
  A->>A: validate, 1 LLM call (text; images in phase 2), policy
  A-->>M: verdict, severity, reasons, images_checked
  M->>M: save result
  M->>Q: place.ai_passed (warning?) or place.ai_rejected
  Q->>T: deliver, ignore if revision is stale
  T->>T: moderationStatus = approved | warning | rejected
```

- One LLM call per place. The LLM returns findings (`category`, `severity` 0 to 1); `policy.py` decides:
  `>= 0.8` Reject, `>= 0.4` Warning, else Pass.
- Categories: `hate, violence, sexual, scam, misleading, irrelevant, other`. `irrelevant` = not travel content.
- Provider-blocked text (`LLMBlockedError`) is a Reject with category `other`.
- Phase 2 (images): up to 5 images in the same Gemini call. A place with images is never sent to Groq (text only)
  and is never Passed with unchecked images: an image that permanently cannot be read gives a Warning with
  reason `images[n]`; a temporary failure is retried.

## 5. Flow F2: tour moderation

```mermaid
sequenceDiagram
  participant T as Tour
  participant M as Moderation
  participant A as AI
  T->>T: author submits; all places approved or warning (else blocked); status=ai_checking
  T->>M: tour.submitted (title, description, type, duration, city, places with lat/lng/sequence)
  M->>M: upsert case; run geo rules (pure JS, no LLM)
  M->>A: POST /moderate/tour (text only: title, description, places name + first 300 chars)
  A-->>M: verdict for title / description / coherence
  M->>M: merge geo findings + AI verdict (worst wins)
  M->>T: tour.ai_passed (warning?) or tour.ai_rejected
  T->>T: pending_review | ai_warning | draft (with reasons)
```

Places are not rescanned: their own moderation already happened in F1, and Tour refuses submission while a place
is `checking` or `rejected`. The tour scan reads place names and short descriptions **only** to judge coherence
(does the tour description match its stops, are the stops in the stated city).

### 5.1 Geo rules (Moderation, `domain/geo/tour-geo-rules.js`)

Deterministic, free, fully unit-tested. Limits depend on `tour.type` and come from the environment.

| Rule | Check | Default limits (walking / cycling / driving) | Result |
| --- | --- | --- | --- |
| G1 invalid coordinate | lat outside -90..90, lng outside -180..180, or exactly (0, 0) | | Reject (`route`, severity 1) |
| G2 duplicate stop | two stops closer than 10 m | | Warning 0.4 |
| G3 long leg | distance between consecutive stops (by `sequence`) | 3 km / 15 km / 100 km | Warning 0.5; above 5x the limit Warning 0.7 |
| G4 spread | farthest stop from the centroid | 10 km / 40 km / 200 km | Warning 0.5 |
| G5 duration | route length / speed (4.5 / 15 / 40 km/h) + 5 min per stop, compared with `duration` | more than 2x `duration` | Warning 0.4 |
| G6 zig-zag | route length by `sequence` vs nearest-neighbour route | more than 1.8x | Warning 0.4 (info for the author) |

`indoor` tours only run G1 and G2. Geo findings never Reject except G1: any doubt goes to a human (Admin).
Geo findings use the new category `route` and `field` = `route` or `places[i]`.

### 5.2 Merging signals

`merge-verdicts.js`: the worst verdict wins (Reject > Warning > Pass), `severity` = max, reasons are concatenated
(AI first, then geo), each reason carries `source: "ai" | "geo"`.

## 6. Contracts

### 6.1 Events (`shared/events/index.js`, camelCase, `at` ends with `Z`)

All new keys are optional for existing events, so Notification and old publishers keep working.

```js
// new
'place.submitted': { placeId, tourId, contributorId, revision, name, type?, description, language,
                     lat, lng, city?, images?: [{ url, caption? }] /* max 5 */, at? }
'place.ai_passed':   { placeId, tourId, revision, warning?, severity?, reasons?: Reason[], at? }
'place.ai_rejected': { placeId, tourId, revision, reason /* max 1000 */, reasons?: Reason[], at? }

// extended (old keys unchanged)
'tour.submitted':    { tourId, contributorId, at?, revision?, title?, description?, language?, city?,
                       type?, durationMinutes?,
                       places?: [{ placeId, name, type?, description, lat, lng, sequence }] /* max 50 */ }
'tour.ai_passed':    { tourId, at?, revision?, warning?, severity?, reasons?: Reason[], ...recipient }
'tour.ai_rejected':  { tourId, reason, at?, revision?, reasons?: Reason[], ...recipient }

Reason = { field, category, message, source: 'ai' | 'geo', severity? }
```

`revision` is Tour's `updatedAt` (ISO string with `Z`), echoed back; Tour drops a result whose revision is stale.

### 6.2 HTTP (Moderation → AI, snake_case, header `x-internal-token`)

```text
POST /moderate/place  { place_id, tour_id, name, type?, description, language, city?, images?[{url, caption?}] }
POST /moderate/tour   { tour_id, title, description, language, city?, type?, duration_minutes?,
                        places[{ place_id, name, type?, description }] }
200 { place_id | tour_id, verdict, severity, reasons[{field, category, message}], images_checked?, model }
401 bad token   422 invalid input (permanent)   503 all providers failed (temporary, retry)
```

Moderation converts camelCase ↔ snake_case only in `application/dtos/ai-mapping.js` and truncates fields to the
limits before the call (title 200, tour description 5000, place name 200, place description 2000, 50 places,
5 images).

## 7. Reliability

| Concern | Decision |
| --- | --- |
| Duplicate events | One row per `(subjectType, subjectId, revision)`; an existing result is re-published, no new AI call |
| Crash safety | Consumer saves the case, then acks. A handler never throws for work it wants to retry (shared `consume()` nacks without requeue) |
| AI errors | 3 attempts (2 s, 4 s) on timeout, 429, 503, network. 422 and other 4xx are permanent → case `failed_permanent`, publish a Warning so a human looks at it |
| AI down after retries | Case `ai_failed`, publish nothing, Tour stays `ai_checking`. A sweeper retries `ai_failed` and stale `pending` cases every 60 s |
| Quota | Moderation prefetch 2 + a semaphore in AI; Groq absorbs text-only overflow |
| Feature flag | Tour: `MODERATION_EVENTS_ENABLED=false` by default = today's direct publish, unchanged |
| Observability | Structured logs with `subjectId`, `revision`, `attempt`, `model`; optional LangSmith tracing in AI (section 8.1) |

Case states: `pending → reviewing → done | ai_failed | failed_permanent`; `ai_failed → reviewing` (sweeper).

## 8. Frameworks: LangChain, LangGraph, LangSmith, graph RAG

### 8.1 Moderation (phases 1 and 2): plain Python, LangSmith tracing only

Moderation is one fixed step: one prompt, one structured answer, a deterministic policy. A graph framework adds
dependencies without adding behaviour, and the existing tested `llm/*` clients (Gemini, Groq, fallback) already do
what `with_fallbacks` would do. Decision: keep plain Python, and add **LangSmith tracing** through the
`langsmith` package (`@traceable`) behind `LANGSMITH_TRACING=false` by default, so prompts, latency and token
usage of each moderation call can be inspected. Tests never enable it.

### 8.2 Chatbot (phase 3): LangGraph + LangChain + LangSmith

```text
            ┌──────────── LangGraph StateGraph (state: messages, lang, filters, retrieved) ───────────┐
 question ─▶│ classify ─▶ (needs data?) ─▶ plan query ─▶ retrieve (graph + vector) ─▶ answer ─▶ cite │─▶ SSE
            │                 └── small talk / out of scope ─────────────────────────▶ answer       │
            └───────────────── memory: last N turns per session (checkpointer) ───────────────────────┘
```

- **LangChain**: chat model wrappers (Gemini via `langchain-google-genai`, Groq via `langchain-groq`) with
  `with_fallbacks`, prompt templates, tool definitions (`search_tours`, `search_places`, `nearby_places`).
- **LangGraph**: the agent graph above, conditional edges, short-term memory with a checkpointer.
- **LangSmith**: tracing in dev, and offline evaluation datasets (question → expected tours) in CI-free scripts.

### 8.3 Graph RAG with several layers

Knowledge graph built only from **public** tours and places:

```text
 Layer 1  City ──has──▶ Tour ──has_stop{sequence}──▶ Place ──is_a──▶ PlaceType
 Layer 2  Place ──near{meters}──▶ Place        (computed with haversine, < 1 km)
 Layer 3  Tour / Place ──about──▶ Topic        (LLM-extracted at ingest: history, food, architecture...)
 Vectors  chunks of tour and place descriptions (multilingual embeddings)
```

Retrieval = hybrid: vector search finds seed tours and places, then a 1 to 2 hop expansion over the graph
(same city, nearby places, shared topics) adds context, then a reranker keeps the top k. This answers questions
like "a food tour near Ben Thanh market that also passes historic sites", which plain vector search does poorly.

### 8.4 Phase 3 open decisions (decided at the start of phase 3)

| Question | Proposed default |
| --- | --- |
| Where to store vectors and graph | AI-owned schema `ai` in the existing Postgres with `pgvector` (build a small image `postgis + pgvector`) and edge tables; no Neo4j. Alternative: Chroma inside the AI container |
| How the chatbot gets public data | A content-carrying `tour.published` event consumed by an indexer in AI (the only RabbitMQ consumer in AI), or a nightly pull from Tour's public read API. Needs team agreement |
| Embeddings | Gemini `text-embedding-004` (multilingual), fallback a local small model |

## 9. Code layout

```text
services/ai/app/
  api/            moderation.py (POST /moderate/place, /moderate/tour), chat.py (phase 3), translation.py (not ours)
  middleware/     auth.py (x-internal-token on /moderate/*)
  llm/            gemini_client.py groq_client.py fallback.py errors.py (existing)
  moderation/     schema.py policy.py validator.py pipeline.py place_service.py tour_service.py images.py
                  tracing.py (LangSmith, optional)  prompts/{place,tour}_moderation.txt
  chatbot/        graph/ (LangGraph nodes, state)  rag/ (ingest, graph_store, vector_store, retriever)
                  tools/  prompts/                                                             (phase 3)
services/moderation/src/
  config.js container.js index.js
  domain/         entities/moderation-case.js  moderation/{case-state-machine,merge-verdicts}.js
                  geo/{distance,tour-geo-rules}.js  ports/  errors/
  application/    dtos/ai-mapping.js  use-cases/{run-place-review,run-tour-review,retry-failed-cases}.js
  infrastructure/ ai/http-ai-reviewer.js  retry/with-retry.js  persistence/*  messaging/event-publisher.js
  interfaces/     events/{place,tour}-submitted-consumer.js  jobs/retry-sweeper.js
```

Dependency direction in Moderation: `interfaces → application → domain`; `infrastructure` implements ports;
only `container.js` wires them.

## 10. Task list (GitHub issues, label `ai-service`)

| Code | Issue | Title | Phase | Depends on |
| --- | --- | --- | --- | --- |
| #AI-25 | #166 | Write AI and Moderation architecture V4 and spec | 1 | |
| #AI-26 | #167 | Extend shared events for place and tour moderation | 1 | 25 |
| #AI-27 | #168 | Add AI and Moderation env variables and compose wiring | 1 | |
| #AI-28 | #169 | Add internal token auth and input validator to AI service | 1 | |
| #AI-29 | #170 | Implement place text moderation in AI service | 1 | 28 |
| #AI-30 | #171 | Add POST /moderate/place endpoint and pipeline | 1 | 29 |
| #AI-31 | #172 | Implement tour content moderation and POST /moderate/tour | 1 | 30 |
| #AI-32 | #173 | Add optional LangSmith tracing to moderation calls | 1 | 30 |
| #AI-33 | #174 | Add moderation case persistence and state machine | 1 | |
| #AI-34 | #175 | Add HTTP AI reviewer with retry and truncation | 1 | 33 |
| #AI-35 | #176 | Implement tour geo rules | 1 | |
| #AI-36 | #177 | Wire place review flow in Moderation | 1 | 26, 33, 34 |
| #AI-37 | #178 | Wire tour review flow with geo and AI merge | 1 | 35, 36 |
| #AI-38 | #179 | Add retry sweeper for failed moderation cases | 1 | 36 |
| #AI-39 | #180 | Integrate moderation events in Tour behind a feature flag | 1 | 26 |
| #AI-40 | #181 | Add moderation end-to-end test script | 1 | 37, 39 |
| #AI-41 | #182 | Moderate place images with Gemini | 2 | 30 |
| #AI-42 | #183 | Carry place images through Moderation | 2 | 36, 41 |
| #AI-43 | #184 | Design chatbot: LangGraph agent and graph RAG | 3 | |
| #AI-44 | #185 | Build chatbot knowledge graph and vector index | 3 | 43 |
| #AI-45 | #186 | Implement hybrid graph and vector retriever | 3 | 44 |
| #AI-46 | #187 | Implement LangGraph chat agent with tools and memory | 3 | 45 |
| #AI-47 | #188 | Add POST /chat streaming and gateway route | 3 | 46 |
| #AI-48 | #189 | Add chatbot evaluation with LangSmith datasets | 3 | 46 |

Order for phase 1: 25 → 26, 27 → AI track (28 → 29 → 30 → 31 → 32) and Moderation track
(33 → 34, 35 → 36 → 37 → 38) in parallel → 39 → 40.

## 11. Decisions that change compared with `AI_PLAN.md` (V3)

| Old | New |
| --- | --- |
| D7 place without a tour | Dropped: `Place.tourId` is required in the real schema |
| D12 no LangChain / LangGraph / LangSmith | Moderation: plain Python + optional LangSmith tracing. Chatbot: LangGraph + LangChain + LangSmith |
| Tour moderation = text only | Tour moderation = text (AI) + geo rules (Moderation), merged |
| Categories | Add `route` for geo findings |
| AI failure after retries on 4xx | Permanent 4xx publishes a Warning (human review) instead of nothing |
| Issues #AI-11 to #AI-24 | Superseded by #AI-25 to #AI-48 |
