# GeoSound frontend readiness against design A

Date: 2026-10-27. Baseline: `develop` at `076886b`. This is a source and
integration audit, not a statement that every use case is complete.

The approved UX/UI design contains 29 boards covering UC01–UC22. The design
directory was already untracked in the author's workspace at audit time, so it
is not part of this branch. Board references below identify the approved local
design; do not assume these PNGs have been committed to GitHub.

## Actual interfaces and access

| Area | Available contract on this baseline | Access and limits |
| --- | --- | --- |
| Authentication | `/api/auth/register`, `verify-otp`, `resend-otp`, `login`, `forgot-password`, `reset-password`, `refresh` | Self-registration accepts tourist or contributor. JWT carries the user role. OTP verification and password reset do not issue login tokens. The error handler exposes status, code, message and optional `details`; it does not serialize ban reason or lock expiry. |
| Public discovery | `GET /api/tours`, `GET /api/tours/:id?lang=`, `GET /api/places` | Public reads. Search serves tours whose status is `public`; the current direct-publish route can set that status without Admin moderation. Tour detail returns places, route, languages and audio metadata. It does not return a public author profile. |
| Personal itinerary | `/api/itineraries` and `/:id/items`, `/:id/share`; public `GET /api/itineraries/shared/:token` | Owner operations require JWT and use the authenticated subject. Shared view is public. Lists include name, counts, estimated distance/time, snapshot cover and update time; no editable description or offline package is exposed. |
| Contributor Studio | `/api/tours` creation; `/api/tours/mine`, `/mine/:id`, places, route-config, languages, translations, TTS preview, readiness and preview | Contributor JWT and owner checks. Images/audio can be uploaded through `/api/media`. The existing `publish` endpoint publishes directly and is not UC15 submission. |
| Moderation, reports, Admin | Moderation exposes only `/health` | No application routes for submission, moderation queue, decisions, reports, account sanctions, dashboard or audit-log queries. AI moderation exists separately but is not a complete publication workflow. |
| Media, offline and translation | Upload endpoint exists; TTS adapter returns `tts://` with `prerendered: false` | A placeholder is not a downloadable audio file. Translation can use the AI adapter or the dev echo adapter. No offline manifest, resumable package, language-size or tile-cache contract exists. |

Source evidence: [gateway routes](../../gateway/src/index.js), [auth routes](../../services/auth/src/interfaces/http/routes/auth-routes.js), [auth schemas](../../services/auth/src/application/dtos/schemas.js), [JWT and error serialization](../../shared/middleware/index.js), [tour routes](../../services/tour/src/index.js), [tour creation and readiness](../../services/tour/src/interfaces/http/routes/tour-routes.js), [itinerary routes](../../services/tour/src/interfaces/http/routes/itinerary-routes.js), [moderation service](../../services/moderation/src/index.js), [TTS adapter](../../services/tour/src/infrastructure/i18n/placeholder-tts.js), and [language data](../../services/tour/src/application/use-cases/get-language-config.js).

## Board coverage and task dependencies

The existing merged page or capability is listed where available. An issue
represents a scoped change or a missing dependency, not a claim that the whole
board already meets its use case. UI state issues based on an existing page can
be reviewed independently from its visual issue. Validation messages that share
one form and request lifecycle stay together to avoid overlapping handlers.

| Board | Current basis and frontend work | Missing backend or dependency |
| --- | --- | --- |
| 01 Login and recovery | Existing UC01 UI #50/#70; login A [#87](https://github.com/Tran-Gia-Phuc/GeoSound/issues/87), locked/banned response [#88](https://github.com/Tran-Gia-Phuc/GeoSound/issues/88), reset [#90](https://github.com/Tran-Gia-Phuc/GeoSound/issues/90). | Phone login, serialized lock expiry and ban reason are not exposed. |
| 02 Registration and OTP | Existing auth APIs; registration A [#89](https://github.com/Tran-Gia-Phuc/GeoSound/issues/89). | Delivery depends on configured SMTP. A real email-delivery end-to-end flow was not exercised by this audit. |
| 03 Discover tours | Existing discovery/map #73/#83; A layout [#91](https://github.com/Tran-Gia-Phuc/GeoSound/issues/91), retry [#92](https://github.com/Tran-Gia-Phuc/GeoSound/issues/92). | Offline package and favorites are unavailable. |
| 04 Tour detail | Existing detail #53/#74; A layout [#93](https://github.com/Tran-Gia-Phuc/GeoSound/issues/93), language failure [#94](https://github.com/Tran-Gia-Phuc/GeoSound/issues/94). | Author profile, review/report and offline download are separate dependencies. |
| 05 Offline | [#103](https://github.com/Tran-Gia-Phuc/GeoSound/issues/103), interrupted/quota state [#104](https://github.com/Tran-Gia-Phuc/GeoSound/issues/104). | Download package, per-language audio, byte sizes, resumability and map strategy. |
| 06 Player | Existing GPS/remote player #49/#52; labeled controls [#101](https://github.com/Tran-Gia-Phuc/GeoSound/issues/101), first-gesture audio race [#155](https://github.com/Tran-Gia-Phuc/GeoSound/issues/155). | TTS pre-render/offline support remains unavailable. |
| 07 Player states | Existing mode/permission/preview UI; audio retry [#102](https://github.com/Tran-Gia-Phuc/GeoSound/issues/102). | Reliable offline playback requires #103. |
| 08 Review and report | Review [#105](https://github.com/Tran-Gia-Phuc/GeoSound/issues/105), report [#106](https://github.com/Tran-Gia-Phuc/GeoSound/issues/106). | No review CRUD, report submission or duplicate-report contract. |
| 09 Place exploration | Existing exploration and quick-add #73/#75/#83; discovery A and retry #91/#92. | User-created private/public place semantics must remain those enforced by the existing API. |
| 10 Itinerary library/editor | Existing itinerary #51/#75/#81; library [#95](https://github.com/Tran-Gia-Phuc/GeoSound/issues/95), load recovery [#96](https://github.com/Tran-Gia-Phuc/GeoSound/issues/96), editor [#97](https://github.com/Tran-Gia-Phuc/GeoSound/issues/97). | Offline download #103; no itinerary description or revision-history endpoint. |
| 11 Itinerary playback | Existing shared player #52; shared transport #101 and error recovery #102. | Offline audio #103. |
| 12 Studio library | Existing Studio #54/#77; navigation [#86](https://github.com/Tran-Gia-Phuc/GeoSound/issues/86), library [#98](https://github.com/Tran-Gia-Phuc/GeoSound/issues/98). | Review lifecycle, notification and analytics data. |
| 13 Tour information | Existing form/upload #76/#77; creation [#99](https://github.com/Tran-Gia-Phuc/GeoSound/issues/99), image-review state [#137](https://github.com/Tran-Gia-Phuc/GeoSound/issues/137). | No image moderation decision from upload; existing AI phase-2 work is #65. |
| 14 Stop editor | Existing map-first editor, upload and recording #78/#84; forbidden-zone errors are returned by the existing save API. | Image moderation #137; do not infer a submission result from a place-save error. |
| 15 Route editor | Existing zone/route editor #79 and authenticated GET/PUT route config. | Default GET triggers may contain `nextHint: null`; the current PUT schema requires it to be omitted or an object. The live test omitted null before PUT. |
| 16 Languages | Existing language tabs #82; truthful audio preview [#100](https://github.com/Tran-Gia-Phuc/GeoSound/issues/100). | Audio pre-render and offline delivery are missing. |
| 17 Preview | Existing author preview and simulation #80. | Admin preview needs its own authorized read-only contract #123. |
| 18 Limited access | Owner settings [#107](https://github.com/Tran-Gia-Phuc/GeoSound/issues/107), tester entry [#108](https://github.com/Tran-Gia-Phuc/GeoSound/issues/108). | Passcode management, verification and access-scoped content. |
| 19 Submit for review | Main [#109](https://github.com/Tran-Gia-Phuc/GeoSound/issues/109); Pass [#110](https://github.com/Tran-Gia-Phuc/GeoSound/issues/110), Warning [#111](https://github.com/Tran-Gia-Phuc/GeoSound/issues/111), Reject [#112](https://github.com/Tran-Gia-Phuc/GeoSound/issues/112), forbidden location [#113](https://github.com/Tran-Gia-Phuc/GeoSound/issues/113), long-running state [#114](https://github.com/Tran-Gia-Phuc/GeoSound/issues/114). | Submission/status API and AI-to-Admin lifecycle; existing AI issue #63 is related but does not alone complete the workflow. |
| 20 Notifications/history | In-app [#115](https://github.com/Tran-Gia-Phuc/GeoSound/issues/115), history [#116](https://github.com/Tran-Gia-Phuc/GeoSound/issues/116). | Email worker exists; owner-scoped inbox/read/history endpoints do not. |
| 21 Contributor analytics | [#117](https://github.com/Tran-Gia-Phuc/GeoSound/issues/117). | Event aggregation, period/language filters and review data. |
| 22 Author profile | Public profile [#118](https://github.com/Tran-Gia-Phuc/GeoSound/issues/118), editing [#119](https://github.com/Tran-Gia-Phuc/GeoSound/issues/119), follow [#120](https://github.com/Tran-Gia-Phuc/GeoSound/issues/120). | Profile and follow APIs. |
| 23 Admin dashboard | [#121](https://github.com/Tran-Gia-Phuc/GeoSound/issues/121). | Authorized statistics and queue/report data. |
| 24 Admin queue | [#122](https://github.com/Tran-Gia-Phuc/GeoSound/issues/122). | Authorized queue and persisted AI outcome/priority. |
| 25 Admin dossier/actions | Dossier [#123](https://github.com/Tran-Gia-Phuc/GeoSound/issues/123), approve [#124](https://github.com/Tran-Gia-Phuc/GeoSound/issues/124), reject [#125](https://github.com/Tran-Gia-Phuc/GeoSound/issues/125), request changes [#126](https://github.com/Tran-Gia-Phuc/GeoSound/issues/126). | Authorized read-only dossier, transitions, reasons, audit and notification. |
| 26 Admin reports | Queue [#127](https://github.com/Tran-Gia-Phuc/GeoSound/issues/127), hide [#128](https://github.com/Tran-Gia-Phuc/GeoSound/issues/128), restore [#129](https://github.com/Tran-Gia-Phuc/GeoSound/issues/129), dismiss [#130](https://github.com/Tran-Gia-Phuc/GeoSound/issues/130). | Report storage, distinct reporter aggregation, authorized actions and audit. |
| 27 Admin accounts | Search [#131](https://github.com/Tran-Gia-Phuc/GeoSound/issues/131), warning [#132](https://github.com/Tran-Gia-Phuc/GeoSound/issues/132), suspension [#133](https://github.com/Tran-Gia-Phuc/GeoSound/issues/133), ban [#134](https://github.com/Tran-Gia-Phuc/GeoSound/issues/134), restore [#135](https://github.com/Tran-Gia-Phuc/GeoSound/issues/135). | Admin account and sanction APIs; login brute-force lock is a different mechanism. |
| 28 Admin audit log | [#136](https://github.com/Tran-Gia-Phuc/GeoSound/issues/136). | Actor/action/target/reason query, filters and immutability contract. The placeholder Prisma model alone is insufficient. |
| 29 Supplementary actions | Player controls/error #101/#102. | Download management #103 and review/report #105/#106. |

## Checks and their scope

- Baseline production build passed, and workspace backend tests passed: 141
  tests across five workspaces. The 17 scoped frontend branches each built.
- Gateway, auth, tour and media health returned HTTP 200. A test contributor
  session read public tour/place data, own tours, places, route, languages,
  readiness, preview and itinerary lists from the running backend.
- A temporary contributor draft and itinerary exercised actual create, read,
  update, reorder, route, language, preview, share and delete endpoints. Only
  records created by the test were deleted. One initial route round-trip failed
  because the GET response contained null `nextHint`; retry succeeded after
  omitting null properties. TTS preview returned `prerendered: false`.
- Browser tests on individual branches use real code with explicit HTTP fixtures
  for failure/edge cases. Separate optional browser reads target the live
  gateway. Fixture success does not verify SMTP delivery or an absent API.
- A real-audio browser test reproduced a first-gesture unlock race on `develop`:
  a pending unlock could reset the active track after a seek. The independent
  fix and regression test are tracked in #155.
- No production backend code or database schema was changed by these tasks.
  The auth container was started with `npm start` to avoid its default `db push`
  against the configured shared database.

Each frontend issue has its own branch from the latest `develop` observed when
created. Shared Playwright configuration is identical across those branches;
each page or independently testable state has its own spec and is intended to
have its own commit. Review and merge remain a team decision.
