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


## 3. Current state (2026-11-07)

- **Phases 1, 2 and 3 work end to end on the real stack** (Supabase, RabbitMQ, real Gemini), checked on 2026-10-30:
  - place moderation (approved / rejected with reasons, publish blocked by a rejected place), tour moderation (`ai_warning` / `pending_review`), edit while in review withdraws to `draft`;
  - chatbot: Tour publish → `tour.published` → indexer (pgvector, schema `ai`) → `/chat` answers with citations; unpublish removes the tour.
- Tour schema `tour` on Supabase has the moderation columns (pushed 2026-10-30, additive).
- Auth schema `app_auth` on Supabase has the UC23 table `sessions` (pushed by the user 2026-10-31); Auth runs on it.
- Backend tasks handed over to the user are done: UC19 admin review, UC23 devices (including password change, #256, and the admin online view, #265), contributor email lookup for Notification (#258). Real SMTP (Gmail app password) is set in the user's `.env` and works (checked 2026-11-01).
- An admin account is made by hand: `update app_auth.users set role = 'admin' where email = '...'` in the Supabase SQL editor, then sign in again. There is no admin sign-up.
- Phones reach the stack through ngrok (`scripts/demo/`, fixed domain per teammate in `.env`); media URLs on `localhost` are rewritten by the client (#263).
- Later use cases (section 6): all nine done on 2026-11-07, backend and client, schemas pushed to Supabase and every route checked on the real stack (2026-11-04). The `[Frontend A]` issues #105 to #108, #115 to #121, #127 to #136 and #162 to #165 are closed with their UC PRs.
- Chatbot UI (2026-11-09, PR #316): floating chat button on the tab layouts (bottom sheet on phones, side panel on desktop) and `/chat`, streaming SSE through `api.stream`, session in localStorage + `/api/chat/history`, citation chips and sources; hidden when the chatbot is off. Since 2026-11-08 the client sends the position with "near me" questions (or always, when location is already allowed) and place citations carry `tour_id`, so they link to their tour.
- Both Tour flags are off by default. To turn the full flow on: `MODERATION_EVENTS_ENABLED=true` and `CHATBOT_EVENTS_ENABLED=true` in `.env`, plus `INTERNAL_SERVICE_TOKEN`, `CHATBOT_ENABLED`, `CHATBOT_INDEXER_ENABLED`, `DATABASE_URL_AI`, `DATABASE_URL_DIRECT_AI` (and `CHAT_MEMORY_BACKEND=postgres` for shared chat memory).
- Nothing waits for other owners. With moderation on, a tour stops at `pending_review` until an admin decides through `/api/tours/admin/reviews` (UC#19, #243). The Supabase password shared in chat must be reset by the project owner.
- Never run real Gemini without an explicit request.

- Use case docs (2026-11-08, branch `docs/use-cases-sync`): all 23 UC files under `docs/use case/` were rewritten from the real code (Maturity `Implemented`, a "Hiện thực trong hệ thống" section with services, screens, API, events and tables, and a Mermaid sequence diagram). New **UC24 – Hỏi đáp với trợ lý du lịch AI** (`lam-sau/UC24-hoi-dap-tro-ly-ai.md`). The index `00-danh-sach-use-case.md` lists 24 UCs; the folders `lam-truoc` / `lam-sau` now only mean build order. Decision (user, 2026-11-08): the docs follow the current code; gaps are written as "Giới hạn đã biết" in the UC files.
  - Every UC file also names the real code: function names at the end of each system step and a **Mã nguồn chính** table (step, function / class, repo-relative file); all cited paths exist (checked 2026-11-08).
  - Design notes fixed to match the code: `chatbot-architecture.md` (indexer flag, per-IP rate limit, `tour.published`), `device-sessions.md` 5.6, `notification-otp-design.md` (Auth sends the OTP email), `uc14-restricted-access.md` section 5 (no offline download for testers, see L9).
  - Gaps kept as current behaviour (code not changed): the Notification OTP template is unused; change password has an API but no screen; itineraries cannot be downloaded offline; `tts.render.completed` is never published; UC21 rows reach the UC22 log only when a Tour broker flag is on.

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
| UC23 signed-in devices, Auth backend | #247 | `feature/uc23-device-sessions` | merged (PR #249); table `sessions` pushed to Supabase 2026-10-31 |
| UC23 signed-in devices, client screen | #248 | `feature/uc23-devices-screen` | merged (PR #250) |
| UC23 revocation check in Media | #251 | `fix/media-session-revocation` | merged (PR #252) |
| geo reasons in the tour language | #253 | `fix/geo-reasons-language` | merged (PR #254) |
| UC23 password change while signed in | #256 | `feature/uc23-change-password` | merged (PR #257) |
| contributor email lookup (Notification -> Auth) | #258 | `feature/notification-contributor-email` | merged (PR #259) |
| phone demo through ngrok (`scripts/demo/`, `docs/04-guides/phone-demo.md`) | | `chore/phone-demo-ngrok`, `chore/phone-demo-autostart` | merged (PR #261, PR #262) |
| place audio silent on Android Chrome, local media URLs on phones | #263 | `fix/android-place-audio` | merged (PR #264) |
| UC23 admin view of online devices (heartbeat + `/admin/devices`) | #265 | `feature/uc23-admin-online-devices` | merged (PR #266); no schema change |

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
| follow-ups | (1) Done in #253. (2) Done in #258: Notification asks Auth `GET /internal/users/:id/contact` (header `x-internal-token`, refused through the gateway) when an event has no `contributorEmail` |
| UC23 | Schema pushed (2026-10-31). Password change while signed in: `POST /api/auth/change-password` (#256). Admin online view: `GET /api/auth/admin/sessions` + heartbeat (#265). Not built: the UC21 ban call to `RevokeAllSessions` (planned in UC21 #274; the use case is ready in `container.js`), IP location (null resolver). Clients must not refresh in parallel: the web client serialises refreshes across tabs with a Web Lock (reuse of a rotated refresh token signs the session out) |

## 6. Later use cases (`docs/use case/lam-sau`, label `uc-later`)

The user asked on 2026-11-03 to build the later use cases, backend and client screens, one issue per UC.
Run each with the skill `/uc-task <N>` (`.claude/skills/uc-task/SKILL.md`). The `[Frontend A]` issues
listed per UC describe the screen states; they are closed together with the UC when its PR covers them.

### 6.1 Tasks (suggested order: P0/P1 first, then dependencies)

| # | UC | Issue | Priority | Service(s) | Depends on | Frontend A issues | Branch | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | UC05 rating and review | #267 | P0 | Tour (+ Auth `name` claim), client | | #105, #162, #163 | `feature/uc05-ratings` | done: backend PR #277, client PR #288; schema pushed 2026-11-04 |
| 2 | UC06 report a tour | #268 | P1 | Tour, client | | #106, #164, #165 | `feature/uc06-reports` | done: backend PR #278, client PR #291 |
| 3 | UC20 admin handling of reports | #273 | P1 | Tour, client | UC06 | #127 to #130 | `feature/uc20-report-handling` | done: backend PR #280, client PR #287 |
| 4 | UC16 status and in-app notifications | #270 | P1 | Notification (+ HTTP port), Gateway, client | | #115, #116 | `feature/uc16-notifications` | done: backend PR #279, client PR #286 |
| 5 | UC21 admin account actions | #274 | P2 | Auth, Tour (violation history), client | | #131 to #135 | `feature/uc21-account-actions` | done: backend PR #281 (Auth) + #283 (violation history, log), client PR #290 |
| 6 | UC22 dashboard and action log | #275 | P2 | Tour, client | UC20, UC21 | #121, #136 | `feature/uc22-dashboard-log` | done: backend PR #283, client PR #295 |
| 7 | UC17 tour statistics | #271 | P1 | Tour, client | UC05 | #117 | `feature/uc17-tour-stats` | done: backend PR #284, client PR #294 (no download beacon: the client has no offline download yet) |
| 8 | UC14 restricted access (passcode) | #269 | P2 | Tour, AI indexer filter, client | | #107, #108 | `feature/uc14-restricted-access` | done: backend PR #285, client PR #289 |
| 9 | UC18 author page and follow | #272 | P2 | Auth (profile, follows), Tour (public tours), client | | #118 to #120 | `feature/uc18-author-page` | done: backend PR #282, client PR #292; `authorId` in public detail and cards PR #293 |

Follow-ups (2026-11-08): #297 notification list filtered by `tourId` on the server, the Studio moderation history pages from it (PR #303, new index: push the `notification` schema); #298 `GET /api/auth/me/profile` for the profile editor of every role (PR #305); #299 author names in the dashboard top contributors (PR #302); #300 the old "flaky" `player-controls` seek test was a player bug (the range slider re-render undid the seek), fixed with exact assertions (PR #304); #306 race in `notifications.spec` fixed (PR #307); guide `docs/04-guides/run-on-a-new-machine.md` (PR #301). Not part of these UCs: offline download (Frontend issues #103, #104, #158 to #161), so UC17 has no download count yet.

Second wave (asked 2026-11-08), one branch and PR each, closing the `[Frontend A]` issues listed:

| # | Feature | Frontend A issues | Service(s) | Branch | Status |
| --- | --- | --- | --- | --- | --- |
| 10 | UC15 submit a tour for review: checklist, "Gửi duyệt", AI pass / warning / rejected / changes requested states, forbidden-zone details, long-running `ai_checking` polling, place moderation chips | #109 to #114, #137 | client (Tour only if a field is missing) | `feature/uc15-submission-ui` | done (PR #314) |
| 11 | UC19 admin review screens: queue, read-only dossier and preview, approve, reject with reason, request changes | #122 to #126 | client (backend #243 exists) | `feature/uc19-admin-review-ui` | done (PR #310) |
| 12 | Offline download (UC03): package manifest, download with progress, pause / resume, library, delete one language, insufficient storage; UC17 `download` beacon | #103, #104, #158 to #161 | Tour (package API), client | `feature/offline-download` | done (PR #311; table fix #313) |

### 6.2 Decisions (L = later UCs)

| # | Question | Decision |
| --- | --- | --- |
| L1 | Who merges | The user builds these UCs in Tour, Auth, Notification, Gateway and the client (asked 2026-11-03), so PRs are merged by us like the handed-over UC19 / UC23 work. Supabase schema pushes are always run by the user (`uc-task` step 5) |
| L2 | Where data lives | Tour (schema `tour`): ratings, reports, restricted access, activity counters, report handling, admin action log. Auth (`app_auth`): account status and actions, author profile, follows. Notification (`notification`): in-app notifications. No service reads another service's database: data crosses by events or by an API call |
| L3 | Sign-in | Rating, report, follow and passcode unlock need a signed-in account (anti-spam rule of UC05 / UC06). Reading ratings, the author page and public tours stays anonymous |
| L4 | Contracts | New events and keys are additive in `shared/events` (zod); existing `tour.reported` and `tour.hidden` are reused. Admin routes use `verifyJwt(['admin'])` and conditional writes (409 when the state moved), like UC19 |
| L5 | Admin log | Every admin action (UC19 review, UC20 report handling, UC21 account action) is append-only and has actor, target, action, reason and time. Where the single log lives is open question Q14 |
| L6 | Client | Vietnamese UI, design A classes, phone first (390 px), loading / empty / error-with-retry states, Playwright tests with mocked routes |
| L7 | UC05 ratings (answers to Q1 to Q3, 2026-11-03) | Rate any time while signed in, no photos, no AI check of comments (abuse goes through UC06 reports). The author cannot rate their own tour. The seeded demo `average_rating` / `rating_count` are the starting point of the aggregate. Display name = new `name` claim of the Auth access token. Design: `docs/02-design/uc05-ratings.md` |
| L8 | UC06 reports (Q4) | A tour with reports from 5 distinct accounts within 7 days gets a review flag and enters the admin queue (UC20); it stays public and playable. Only the UC20 "hide" removes it |
| L9 | UC14 restricted access (Q5, Q6) | A tester signs in and unlocks with the passcode once; the unlock is kept per account until the author changes the passcode. Offline download for unlocked testers is not built (2026-11-08: the package route serves public tours only; the docs follow the code). Restricted tours never reach search, nearby or the chatbot index. Wrong attempts are rate limited |
| L10 | UC16 notifications (Q7, Q8) | Notification stores in-app notifications (existing `Notification` model) from the events it already consumes, and gets an HTTP port plus the gateway route `/api/notifications`. In-app + the existing email; no web push yet |
| L11 | UC17 statistics (Q9) | View = tour detail opened, play = first stop started, completion = last stop ended, download = offline package saved. Anonymous visitors count by device id. One count per device, tour, action and day |
| L12 | UC18 author page (Q10) | Profile (avatar uploaded through Media, bio) and follows; no follower notification for now |
| L13 | UC20 / UC21 (Q11, Q12) | Restore puts a hidden tour straight back to public (no new moderation, no appeal). Suspension presets 1, 7, 30 days or an end date; warnings never escalate automatically |
| L14 | UC22 log (Q13, Q14) | One append-only table `admin_actions` in Tour for UC19, UC20 and UC21 actions; Auth publishes an event for each account action and Tour records it. Top contributor = most public tours with average rating >= 4 and no hidden tour in the period |
| L15 | UC15 / UC19 (2026-11-08) | The user builds the UC15 submission screens and the UC19 admin review screens (were Frontend A) so a tour can go author -> AI -> admin in the UI. With `MODERATION_EVENTS_ENABLED=true` the Studio publish action submits for review (`ai_checking`); without it, it publishes directly as before |
| L16 | Offline download (2026-11-08) | A package = tour content for one language + images + human-recorded audio files; stops without audio are read by the device voice. Stored in IndexedDB with per-asset transfer state (pause / resume / recovery), images shared between languages are reference-counted, sizes come from the stored bytes. A package is ready only when every asset is stored; then the UC17 `download` beacon is sent once. The service worker of the production build makes `/offline` open without network (the Vite dev server in Docker has no service worker) |

### 6.3 Open questions (ask in the `uc-task` gate, then move the answer to 6.2)

All answered on 2026-11-03 (L7 to L14). New questions found while building go here.

| # | UC | Question | Proposal |
| --- | --- | --- | --- |
