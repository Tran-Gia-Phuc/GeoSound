# Chatbot Architecture (phase 3)

Status: **accepted by the AI owner on 2026-10-28** (options A, pgvector, local embeddings; JWT checks skipped for now). Requests to Tour, Gateway and infra: `ai-integration-requests.md`. Issue #184 (#AI-43).
Owner: AI part of GeoSound. Builds on section 8 of [moderation-architecture.md](moderation-architecture.md)
and closes its section 8.4 (open decisions) with recommendations in section 6 below.

## 1. Goal and scope

Tourists ask questions in Vietnamese or English about **public** tours and places ("a food tour in Hoi An under
two hours", "what is near Ben Thanh market?") and get a short streamed answer that cites the tours and places it
used, so the client can link to them.

| In scope | Out of scope |
| --- | --- |
| Search and compare public tours (city, type, duration, topic) | Booking, payment, prices |
| Explain a public place or tour, list its stops in order | Personal data of users or contributors |
| "What is near X" using place coordinates | Moderation, admin decisions, non-public content |
| Short-term conversation memory per session | Live navigation, audio playback, translation (other features) |
| Answers in `vi` or `en` (the user's language) | General travel knowledge not backed by the index (answer "I don't know") |

Facts from the real code that shape this design (checked in this worktree):

| Fact | Where | Consequence |
| --- | --- | --- |
| A tour is visible to tourists only when `status = 'public'` | `prisma-tour-repository.js`, `tour.js` | The index holds only public tours and their places |
| `PublishTour` sets `public` directly and publishes **no event**; `UnpublishTour` and editing a public tour move it back to `draft`, also without an event | `publish-tour.js`, `tour.js` | Today nothing tells another service that a tour became or stopped being public (section 6b) |
| `tour.approved` and `tour.hidden` exist in `shared/events` but no service publishes them yet (Notification and Media only consume) | `shared/events/index.js`, `services/*/src` | They cannot be the only ingestion signal |
| Public read API: `GET /tours` (search, `limit` max 50, paged) and `GET /tours/:id` (detail, `?lang=`), `GET /places` (explore); all filter `status = 'public'` | `public-tour-routes.js`, `explore-routes.js` | Possible pull source (option B) |
| `PlaceTranslation(placeId, languageCode, text)` and `TourLanguage` hold translated text | `services/tour/prisma/schema.prisma` | Translations become extra vector chunks |
| Local Postgres image is `postgis/postgis:16-3.4` (no pgvector); the shared team DB is Supabase | `docker-compose.yml`, `infra/postgres/init/01-init.sql` | pgvector needs a local image change; Supabase can enable the `vector` extension |
| Gateway has a global Redis rate limit (120 requests per minute per IP) and **no JWT check yet**; no `/api/chat` route | `gateway/src/index.js`, `rate-limit.js` | Chat needs its own stricter limit and a new route |
| AI service has no DB driver and no LangChain packages yet | `services/ai/requirements.txt` | New dependencies in #185 to #187 |

## 2. Architecture and request flow

```text
 Client (PWA)
   │ POST /api/chat  (SSE)            GET /api/chat/history
   ▼
 Gateway :8080 ── chat rate limit (Redis, per user or IP) ── adds x-internal-token ──┐
                                                                                    ▼
 AI service :3004  POST /chat ─▶ LangGraph agent ─▶ retriever ─▶ Postgres schema `ai`
                                   │                              (pgvector chunks + graph tables
                                   │                               + LangGraph checkpoints)
                                   └─▶ Gemini 2.5 Flash (fallback Groq) ─▶ tokens streamed back as SSE

 Ingestion (section 6b):
 Tour ── tour.published / tour.unpublished (content inside) ──▶ RabbitMQ ──▶ AI indexer ──▶ schema `ai`
```

Request flow for one turn:

1. The client sends `POST /api/chat` with `message`, optional `session_id` and optional `location`.
2. The gateway applies the chat rate limit, forwards to `ai:3004/chat` and adds `x-internal-token`, so `/chat`
   is reachable only through the gateway. When gateway JWT checks exist, it also forwards the user id.
3. The AI service validates input (length, language), loads the session memory and runs the graph.
4. The answer is streamed token by token over SSE, then a `citations` event and a `done` event.
5. The checkpointer saves the turn (trimmed to the last N turns).

Feature flag: `CHATBOT_ENABLED=false` by default. When false, `/chat` returns 404 and the indexer does not start,
so nothing changes for other teammates.

## 3. LangGraph agent

### 3.1 State

| Field | Type | Notes |
| --- | --- | --- |
| `messages` | list of LangChain messages | Trimmed to the last `CHAT_MEMORY_TURNS` (default 6) turns before each prompt |
| `session_id` | string | LangGraph `thread_id` |
| `user_id` | string or null | Only when the gateway forwards it; never sent to the LLM |
| `lang` | `vi` or `en` | From the request, else detected from the message |
| `intent` | `search`, `detail`, `nearby`, `smalltalk`, `out_of_scope` | Set by `classify` |
| `filters` | `{city?, type?, max_duration?, topics[], near?{lat, lng, radius_m}, ref_ids[]}` | Set by `plan` |
| `retrieved` | list of `{kind, id, title, text, score, hops}` | Set by `retrieve`, max k = 5 |
| `answer` | string | Set by `answer` |
| `citations` | list of `{kind, id, title}` | Set by `cite`, subset of `retrieved` |
| `llm_calls` | int | Budget counter, hard cap 2 per turn |

### 3.2 Nodes and edges

```text
 START ─▶ classify ──(intent = smalltalk | out_of_scope)──────────▶ answer
              │                                                       │
              └──(search | detail | nearby)─▶ plan ─▶ retrieve ─▶ answer
                                                                      │
                          answer ──(finish_reason = stop)──▶ cite ─▶ END
                          answer ──(finish_reason = no_data | refused)──▶ END
```

| Node | LLM call | Does |
| --- | --- | --- |
| `classify` | no | Rules: language detection, keyword lists per intent (vi and en, also matched without diacritics), city names (see "City filter" below). Prompt-injection markers in the user text do not change the intent |
| `plan` | no | Builds `filters` and the search text with rules, then a deterministic tool plan run by `retrieve`. Rules always produce seed text (the sanitised message), so the optional planner LLM call of the first draft is **not implemented** |
| `retrieve` | no | Runs the planned tools (section 3.4) over the retriever (section 5) and merges the rows into at most k = 5 items |
| `answer` | **1** for small talk and for data answers; **0** otherwise | Small talk and questions with retrieved items: one prompt (system rules, trimmed memory, retrieved items wrapped as data, user question); `finish_reason = stop`. Out-of-scope questions and data questions with an empty retrieval get a canned, localised (`vi` / `en`) reply with **no LLM call**: `finish_reason = refused` or `no_data`. Content blocked by the provider (or an empty reply) also gives a canned `refused` reply |
| `cite` | no | Runs only after `stop`. Keeps citation markers whose id is in `retrieved` and removes invented ones (see "Citation markers" below) |

Budget: Gemini free tier is 5 requests per minute, shared with moderation. A turn uses **at most one** LLM call
(`answer`); the hard cap stays 2 per turn (`MAX_LLM_CALLS_PER_TURN`, enforced in the graph) so a later planner
call would fit. Tools are called by code, not chosen by the LLM in a loop, because LLM tool calling needs at least
two calls per turn. The tool definitions stay standard LangChain tools so that a paid tier can switch to LLM tool
calling without changing them.

**Citation markers.** The system prompt asks the model to write `[tour:ID]` or `[place:ID]` right after each
tour or place it mentions, using only ids from the retrieved items. `cite` keeps markers of retrieved items,
deletes markers with invented ids from the answer **and** from the stored memory (the stored answer message is
replaced), and builds `citations` (`{kind, id, title}`, order of first mention, also matched on a bare id). The
kept markers **stay in the answer text and in the history**, so `/chat` (#188) and the client must render them
(for example as links) or strip them.

**City filter.** Until the retriever supplies city names, a built-in alias table maps vi and en city names
(with or without diacritics) to canonical English names (`Hanoi`, `Ho Chi Minh City`, `Hoi An`, `Hue`,
`Da Nang`, ...). This is an interim measure: `ChatAgent(city_aliases=...)` lets the retriever (#186) pass names
taken from `City` nodes instead. The retriever must match the canonical names it receives in the `city` filter.

**Location.** The request `location` is kept in a per-turn context variable, never in the graph state or the
checkpoint: the `plan` node stores only the radius, and `retrieve` fills `lat` / `lng` into the `nearby_places`
call at run time. Note: with `LANGSMITH_TRACING=true`, tool inputs (`lat`, `lng`) could still be traced unless
inputs are hidden; to address in #188.

### 3.3 Models and memory

- **LangChain models**: `ChatGoogleGenerativeAI(model="gemini-2.5-flash")` with
  `.with_fallbacks([ChatGroq(...)])`. As in moderation, fallback happens only on timeout, 429 and 5xx, or when the global chat cap is reached (section 7); content
  blocked by the provider is not retried and returns a polite refusal. Chat is text-only, so Groq is allowed.
- **Concurrency**: the chat path shares the AI service semaphore (D13) with moderation; when it is full, `/chat`
  returns 429 with `Retry-After` instead of queueing.
- **Memory**: LangGraph checkpointer per `session_id` (`langgraph-checkpoint-postgres` in schema `ai`;
  `MemorySaver` in tests). Only the last N turns are sent to the LLM. Sessions expire after
  `CHAT_SESSION_TTL_HOURS` (default 24) and are deleted by a cleanup job.

### 3.4 Tools

All tools read only the `ai` schema, which contains only public data.

| Tool | JSON schema (input) | Returns |
| --- | --- | --- |
| `search_tours` | `{"query": string (max 200), "city"?: string, "type"?: "walking" \| "driving" \| "cycling" \| "indoor", "max_duration_minutes"?: int >= 0, "topics"?: string[] (max 5), "language"?: "vi" \| "en", "k"?: int 1..10}` | `[{tour_id, title, city, type, duration_minutes, score, snippet, hops}]` |
| `search_places` | `{"query": string (max 200), "city"?: string, "place_type"?: string, "topics"?: string[] (max 5), "language"?: "vi" \| "en", "k"?: int 1..10}` | `[{place_id, tour_id, name, type, score, snippet, hops}]` |
| `nearby_places` | `{"place_id"?: string, "lat"?: number -90..90, "lng"?: number -180..180, "radius_m"?: int 1..1000 (default 500), "k"?: int 1..10}`; one of `place_id` or `lat`+`lng` is required | `[{place_id, tour_id, name, type, distance_m, snippet, hops}]` (the anchor `place_id` itself is excluded) |

## 4. Multi-layer knowledge graph

Built only from public tours and places (section 6b explains how).

| Layer | Node types | Edge types | Built how |
| --- | --- | --- | --- |
| 1 Structure | `City`, `Tour`, `Place`, `PlaceType` | `City -has-> Tour`, `Tour -has_stop{sequence}-> Place`, `Place -is_a-> PlaceType` | Copied from the ingested content; `City` key = normalised `city` string |
| 2 Space | `Place` | `Place -near{meters}-> Place`, only when `meters < 1000` | Haversine at ingest against places already indexed (bounding-box prefilter, keep the 10 nearest per place, both directions) |
| 3 Meaning | `Topic` | `Tour -about-> Topic`, `Place -about-> Topic` | LLM-extracted at ingest, closed vocabulary (`history, food, architecture, nature, religion, art, culture, shopping, nightlife, family`); cap 5 topics per tour and 3 per place |
| Vectors | chunks | `chunk -of-> Tour or Place` | Tour title + description, place name + description, each `PlaceTranslation.text`; about 800 characters per chunk with small overlap; multilingual embeddings (section 6c) |

Topic extraction costs LLM quota, so it is **one call per tour** (tour and all its places in one prompt), goes
through the same rate limiter, and is skipped when the queue is busy: the tour is indexed without topics
(`topics_pending = true`) and a later job fills them in. Tour text is wrapped as data in that prompt (section 7).

Storage sketch (schema `ai`, section 6a):

| Table | Key columns |
| --- | --- |
| `ai.nodes` | `id` (`tour:<uuid>`, `place:<uuid>`, `city:<slug>`, `type:<value>`, `topic:<slug>`), `kind`, `name`, `props jsonb`, `tour_id`, `revision`, `topics_pending` |
| `ai.edges` | `src`, `dst`, `kind` (`has`, `has_stop`, `is_a`, `near`, `about`), `props jsonb` (`sequence`, `meters`); primary key `(src, dst, kind)` |
| `ai.chunks` | `id`, `node_id`, `lang`, `source` (`description`, `translation`), `text`, `embedding vector(D)`, HNSW cosine index |
| `ai.tour_index` | `tour_id`, `revision`, `state` (`indexed`, `deleted`); a tombstone so a late, older `tour.published` cannot re-index a tour after `tour.unpublished` |
| `ai.index_meta` | `embedding_model`, `dimension` (a model change means a full re-embed) |

Implementation notes (#185): `ai.nodes` also stores `lat` / `lng` for the bounding-box prefilter of `near`; `ai.chunks` also stores `tour_id` for fast deletes; a `tour.unpublished` older than the indexed revision is ignored, one without `revision` always deletes; tours indexed without a topic extractor are marked `topics_pending`. DDL: `services/ai/app/chatbot/rag/sql/schema.sql`.

No contributor id, email or any user field is stored (section 7).

## 5. Hybrid retrieval

1. **Vector seeds**: embed the search text; cosine top `k_seed` chunks (default 20, configurable; optional
   `min_similarity` cut-off), keep the best chunk per node. City (as the set of alias slugs), tour type, max duration and place type are
   applied inside `vector_search` before the top k (SQL `WHERE` in pgvector, TODO(#219)), and chunks of deleted tours
   are skipped, so other cities cannot crowd out the requested one. Graph-reached nodes are re-checked in step 3.
2. **Graph expansion** (1 to 2 hops from the seeds): `Tour -has_stop-> Place`, `Place -near-> Place`,
   `-about-> Topic <-about-` (shared topic), `City -has-> Tour`. Each hop lowers the graph score.
3. **Filter and rerank** without an LLM: hard filters (city, tour type, max duration for tours; city and
   `place_type` for places) drop failing nodes, then
   `score = 0.6 * vector_similarity + 0.2 * graph_proximity + 0.2 * filter_match`
   (`graph_proximity` = 1, 0.5, 0.25 for 0, 1, 2 hops; `filter_match` = share of requested constraints met:
   topics, city, type and max duration for tours, `place_type` for places; hard filters always count as met
   because failing nodes were already dropped). `search_tours` and `search_places` return separate lists; places
   are not deduplicated under their tours.
4. **Top k = 5** items go to `answer`, each with its id, so `cite` can return `{kind, id, title}`.

The Postgres read path (`PgVectorIndexStore` read methods) is still TODO(#219); today only the in-memory store
implements it.

Example: "tour ẩm thực gần chợ Bến Thành có đi qua di tích lịch sử" (a food tour near Ben Thanh market that
also passes historic sites).

| Step | Result |
| --- | --- |
| classify | `lang = vi`, `intent = search` |
| plan | `topics = [food, history]`, `city = Ho Chi Minh City` (matched from a known City node), anchor text "chợ Bến Thành" |
| vector seeds | Place "Chợ Bến Thành" (high similarity); tours whose descriptions talk about street food |
| expansion | `near` from the market place to places within 1 km; `has_stop` back to the tours containing them; `about` keeps tours linked to both `food` and `history` |
| rerank | A walking tour that stops at the market and at a historic site ranks first; a food-only tour ranks lower |
| answer + cite | Short answer in Vietnamese, citations `[{kind: tour, id: ...}, {kind: place, id: ...}]` |

Plain vector search finds the market or a food tour, but not "near the market and also historic"; the graph
hops add that.

Implementation notes (#186): `services/ai/app/chatbot/rag/hybrid_retriever.py` over the `IndexStore` port
(`store.py`).

| Topic | Behaviour |
| --- | --- |
| Score | `score = 0.6 * similarity + 0.2 * graph_proximity + 0.2 * filter_match`. A node reached through the graph also gets its seed similarity multiplied by the hop proximity (1 / 0.5 / 0.25 for 0 / 1 / 2 hops), on top of the graph term, so a same-city tour two hops away cannot outrank a direct seed |
| Filters | City, tour type and max duration are hard filters (a node that fails them is dropped); topics only raise the score. A tour without a duration is dropped when a max duration is given |
| Language | `SearchFilters.language` does not filter results; it only picks the snippet language |
| `nearby_places` | Geo query on place coordinates (`places_near`), not the stored `near` edges, which keep only the 10 nearest per place. `score = 1 - distance / radius`; `hops = 1` when anchored on a place, and the anchor itself is excluded |
| Store read methods | `vector_search`, `get_nodes`, `neighbours`, `places_near`, `get_chunks`, `list_nodes`, `get_revisions` (batch). Every hit is re-checked against the tour index state (`ai.tour_index`, must be `indexed`), so a deleted tour is never returned |

## 6. Decisions (close section 8.4 of moderation-architecture.md)

### 6a. Vector and graph store

| Option | For | Against |
| --- | --- | --- |
| **pgvector in the existing Postgres**, schema `ai`, graph as edge tables | One store for chunks, graph and checkpoints, so ingest and delete are one transaction; SQL joins for filters and hops; Supabase supports the `vector` extension; backups and ops already exist | Local image must change (`postgis/postgis:16-3.4` has no pgvector) |
| Chroma inside the AI container | No infra change; simple Python API | Graph must live elsewhere (two stores to keep consistent on delete); extra volume; another dependency; harder to filter by graph |

**Recommendation: pgvector.** Delete-on-unpublish must be reliable, and one transaction over chunks and edges
is the simplest way to guarantee it. No Neo4j: the graph is small and 2-hop queries are cheap in SQL.

Migration cost: a small `infra/postgres/Dockerfile` (`FROM postgis/postgis:16-3.4` plus the
`postgresql-16-pgvector` package) used by compose; `CREATE EXTENSION vector` and `CREATE SCHEMA ai` added to the
init SQL. Init scripts run only on a new volume, so existing local volumes need these two statements run once by
hand (same as Supabase, where they are run in the SQL editor). A new `DATABASE_URL_AI` (`?schema=ai` style)
variable is needed. This touches shared infra, so it needs a short team review.

### 6b. Ingestion source (needs team agreement, Tour owner)

| Option | How | For | Against |
| --- | --- | --- | --- |
| **A. New content-carrying events** | Tour publishes `tour.published` (full public content) when a tour enters `public`, and `tour.unpublished` when it leaves `public` (unpublish, edit back to `draft`, hide, restrict, delete). An indexer in the AI service consumes them | Push, near real time, no cross-service reads, same pattern as `tour.submitted` (D2) | Needs a change in Tour (owner review) and new schemas in `shared/events`; makes AI a RabbitMQ consumer (see open questions) |
| B. Periodic pull from Tour's public API | The indexer pages `GET /tours` and fetches `GET /tours/:id` every night and at startup, then reconciles | No Tour change; the API already returns public data only | Up to a day stale; a hidden tour stays answerable until the next run; breaks the "only data carried by events" rule unless the team allows it; detail payload may not carry all translations |
| C. Reuse moderation events | Index content from `tour.submitted` / `place.submitted` and wait for an approval signal | No new event | Content is not public at that time; approval (`tour.approved`) is not published today, and direct publish skips moderation entirely; high risk of indexing non-public text. Rejected |

**Recommendation: A**, behind a Tour flag `CHATBOT_EVENTS_ENABLED=false` (same pattern as
`MODERATION_EVENTS_ENABLED`). Proposed payloads (camelCase, additive, `at` ends with `Z`):

| Event | Payload |
| --- | --- |
| `tour.published` | `tourId`, `revision` (Tour `updatedAt`), `status` (must be `public`), `title`, `description`, `language`, `city?`, `type`, `durationMinutes?`, `languages?[]`, `places[{placeId, name, type?, description, lat, lng, sequence, translations?[{language, text}]}]` (max 50), `at?` |
| `tour.unpublished` | `tourId`, `revision?`, `reason` (`unpublished`, `edited`, `hidden`, `restricted`, `deleted`), `at?` |

**This needs team agreement with the Tour owner before any code.** Fallback if A is not agreed: option B
(nightly pull plus a full reconcile), accepted with its staleness, and only if the team allows the AI service to
call Tour's public read API.

How only public data reaches the index:

| Guard | A (events) | B (pull) |
| --- | --- | --- |
| Filter at source | Tour publishes `tour.published` only on a transition into `public` | Public endpoints already filter `status = 'public'` |
| Re-check on ingest | Indexer drops any payload whose `status` is not `public` or whose `revision` is older than the stored one | Indexer drops a tour whose detail call returns 404 |
| Delete on hide or unpublish | `tour.unpublished` (and the existing `tour.hidden` when someone publishes it) deletes the tour, its places, their chunks, `near` and `about` edges in one transaction | Reconcile deletes every indexed tour not seen in the latest full pull |
| Retrieval-time | Queries read only `ai.*`, which holds nothing else | Same |

Handlers are idempotent and never throw for work they want retried (the shared `consume()` nacks without
requeue). Known gap with A: an event lost while the DB is down leaves the index stale (same limit as moderation);
a later `tour.published` or `tour.unpublished` repairs it.

### 6c. Embeddings model

| Option | Dimension | Cost and limits | Notes |
| --- | --- | --- | --- |
| Gemini `text-embedding-004` | 768 | Free tier, rate limited; every chat turn needs one query embedding | Multilingual. Google has announced its retirement in favour of `gemini-embedding-001` (768 to 3072 via output dimensionality); must be checked. The project key is known to work only with `gemini-2.5-flash` (CLAUDE.md section 6), so embedding access is unverified |
| **Local multilingual model**, e.g. `intfloat/multilingual-e5-small` (or `paraphrase-multilingual-MiniLM-L12-v2`) through an ONNX runtime | 384 | No quota, no key, no network at query time | Good enough for vi and en on a small corpus; adds roughly 100 to 500 MB to the AI image depending on runtime |

**Recommendation: local `multilingual-e5-small`, dimension 384.** It keeps the chat LLM quota for the one
`answer` call, works offline in tests, and does not depend on unverified key access. One model per index:
a "fallback" embedding model is not possible, because vectors from two models are not comparable; switching
model means a full re-embed (recorded in `ai.index_meta`). Gemini embeddings stay the alternative if image size
becomes a problem.

### 6d. LangSmith

- **Tracing**: same flag as moderation, `LANGSMITH_TRACING=false` by default, `LANGSMITH_PROJECT` per
  environment; no import side effects when off; never in tests. Traces contain user messages, so tracing stays
  off in shared environments unless the team agrees.
- **Offline evaluation (#189)**: a LangSmith dataset of about 30 questions (vi and en) with expected tour or
  place ids, built over a fixed seed index. Metrics: hit@5 of expected ids, citation validity (every cited id
  exists in the index), answer faithfulness (every claim is supported by the retrieved items), answer
  language matches `lang`, refusal on out-of-scope questions. Run by a script on
  request, not in CI (it calls a real LLM); CI keeps unit tests with `FakeLLM`.

## 7. Security and privacy

| Risk | Measure |
| --- | --- |
| Personal data in the index | Only tour and place content is indexed; never `authorId`, contributor email, ratings by user, itineraries or images. Chat history is per session, expires (24 h default) and is never indexed |
| Prompt injection from tour text | Retrieved text is untrusted: wrap each item with `wrap()` / `sanitize_text()` from `moderation/validator.py` (tags, control characters removed, length clipped) and state in the system prompt that it is data. The LLM never decides tool calls, and `cite` drops ids that were not retrieved |
| Prompt injection from the user | User message max 1000 characters, sanitised the same way; the system prompt restricts the bot to GeoSound public content |
| Abuse and cost | Gateway chat limit (proposed 5 requests per minute and 100 per day per user or IP, `CHAT_RATE_LIMIT_PER_MIN`). Per-user limits alone can exceed the Gemini 5 requests per minute shared with moderation (5 turns times up to 2 LLM calls), so a global chat cap `CHAT_GLOBAL_RATE_LIMIT_PER_MIN` (default 2 turns per minute on Gemini) applies across all users; text-only overflow goes to Groq, and moderation keeps priority on Gemini. AI semaphore; at most 2 LLM calls per turn; prompt token budget (memory trimmed to N turns, k = 5 items, each clipped to 600 characters); answer `max_output_tokens` about 512 |
| Direct access to the AI service | `/chat` requires `x-internal-token`, added by the gateway; the browser never sees the token |
| Secrets | Keys come from env only and are never logged or traced |

## 8. API contract sketch (AI service, snake_case on the wire like D8)

`POST /chat` (through the gateway: `POST /api/chat`), response `text/event-stream`.

| Request field | Type | Rule |
| --- | --- | --- |
| `message` | string | required, 1 to 1000 characters |
| `session_id` | string | optional; created by the server when missing and returned in `meta` |
| `language` | `vi` or `en` | optional; detected when missing |
| `location` | `{lat, lng}` | optional; used only for `nearby`, never stored (per-turn context variable, section 3.2) |

| SSE event | Data |
| --- | --- |
| `meta` | `{session_id, lang}` (first event) |
| `token` | `{text}` (many) |
| `citations` | `{items: [{kind: "tour" \| "place", id, title}]}` |
| `done` | `{finish_reason: "stop" \| "no_data" \| "refused", llm_calls}` |
| `error` | `{code, message}`; then the stream closes |

`GET /chat/history?session_id=...` (gateway: `GET /api/chat/history`) returns
`{session_id, messages: [{role: "user" | "assistant", content, citations?, at}]}`, last N turns only.

Citation markers: `token` text and history `content` contain the kept `[tour:ID]` / `[place:ID]` markers
(section 3.2); invented ids are already removed. `/chat` (#188) must decide whether to stream them as is or strip
them, and the client must render them (for example as links using `citations`) or hide them. Because markers can
be split across tokens, stripping during streaming needs a small buffer.

| Status | Meaning |
| --- | --- |
| 401 | Missing or bad `x-internal-token` (gateway configuration) |
| 404 | `CHATBOT_ENABLED=false`, or unknown `session_id` on history |
| 422 | Invalid input |
| 429 | Rate limit or AI semaphore full; `Retry-After` header |
| 503 | All LLM providers failed before streaming started (after streaming starts, an `error` event is sent instead) |

The gateway proxy for `/api/chat` must not buffer responses, so SSE tokens arrive as they are produced.

## 9. Task breakdown

| Code | Issue | Title | Acceptance hints |
| --- | --- | --- | --- |
| #AI-44 | #185 | Build chatbot knowledge graph and vector index | pgvector image and `ai` schema (6a); tables of section 4; indexer for the agreed source (6b) with public-only guards, idempotent upsert by `revision`, delete in one transaction; `near` < 1 km by haversine; topic extraction capped and rate limited; local embeddings (6c); tests with fake embedder and fake LLM, no network |
| #AI-45 | #186 | Implement hybrid graph and vector retriever | Vector seeds, 1 to 2 hop expansion, rerank, top k with citations (tour and place ids); unit tests on a small fixture graph including the section 5 example; multi-constraint (area + topic) questions return relevant tours in tests; unpublished data is never returned |
| #AI-46 | #187 | Implement LangGraph chat agent with tools and memory | Graph of 3.2 with conditional edges; three tools of 3.4 (`search_tours`, `search_places`, `nearby_places`) with their JSON schemas; at most 2 LLM calls per turn (asserted in tests); Gemini `with_fallbacks` Groq on timeout, 429, 5xx only; checkpointer memory trimmed to N turns; `cite` drops unknown ids; answers cite tour and place ids; out-of-scope questions are answered politely without tools; answers in the request language; tests with `FakeLLM` and `MemorySaver` |
| #AI-47 | #188 | Add POST /chat streaming and gateway route | SSE events of section 8; `GET /chat/history`; `x-internal-token`; `CHATBOT_ENABLED` flag; gateway `/api/chat` route, chat rate limit, no buffering; errors 401, 404, 422, 429, 503 |
| #AI-48 | #189 | Add chatbot evaluation with LangSmith datasets | Dataset of about 30 vi/en questions with expected ids; script reporting hit@5, citation validity, answer faithfulness, language match, refusal rate; script runs locally with a documented command; baseline scores recorded in `docs/03-testing/`; tracing behind `LANGSMITH_TRACING`; not run in CI |

## 10. Open questions for the team

1. Ingestion source (6b): does the Tour owner accept `tour.published` / `tour.unpublished` behind a flag? If not,
   may the AI service call Tour's public read API (fallback B)?
2. `CLAUDE.md` section 2 says the AI service "does not listen to RabbitMQ". That was written for moderation;
   option A adds one consumer (the indexer) to the AI service. The rule needs an explicit exception, or the
   indexer must run as a separate process in the same image.
3. Shared infra (6a): custom Postgres image with pgvector and a new `ai` schema plus `DATABASE_URL_AI`.
4. Gateway: who adds the `/api/chat` route and the stricter chat rate limit, and when will gateway JWT checks
   exist (until then sessions are anonymous)?
5. Embeddings (6c): confirm the image-size cost of a local model, or verify that the project key can call a
   Gemini embedding model.
