# UC22: admin dashboard and action log (design)

Issue #275 (label `uc-later`), plus the Tour part of UC21 (#274, step 2 "violation history").
Use cases: `docs/use case/lam-sau/UC22-dashboard-thong-ke-log.md`, `UC21-quan-ly-tai-khoan-vi-pham.md`.
Step 1 (this note): backend in the Tour service. The admin screens come in a later PR. It reads the
append-only log of UC20 (`uc20-report-handling.md` section 3) and the UC21 event (`uc21-account-actions.md`
section 5).

## 1. Goal

An admin sees the workload of the moderation team (tours waiting for review, average review time,
reported tours, top contributors, actions by type) for a period, reads the log of every admin action
(who approved, hid or banned what, and when) with filters, and sees the violation history of one author
before a UC21 account action.

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | One append-only log `admin_actions` in Tour for UC19, UC20 and UC21 actions (decision L14). The API reads it only; PUT / PATCH / DELETE / POST answer 405 (`method_not_allowed`) |
| R2 | UC19 decisions append `approve_tour`, `reject_tour` or `request_tour_changes` (target `tour`, data `{ fromStatus, queuedAt? }`) in the same transaction as the status change and the `tour_review_actions` row, which UC19 keeps writing for its dossier |
| R3 | UC21 account actions come from Auth as `account.moderated` (queue `tour.admin-log`): `warn_user`, `suspend_user`, `ban_user`, `restore_user`, target `user`, data `{ until? }`, `createdAt` = event `at`. No email or name is stored |
| R4 | Event-fed rows carry a unique `sourceKey` = `account.moderated:<userId>:<action>:<at>`; a redelivered event adds no row (insert with `ON CONFLICT DO NOTHING`). The handler never throws: invalid payloads and errors are logged and the message is acked |
| R5 | Dashboard period `[from, to)`: default the last 7 days, at most 366 days, `from` before `to` (400 otherwise). `YYYY-MM-DD` is a whole UTC day (`to` includes that day); an ISO date-time is used as it is |
| R6 | Average review time = mean of (decision time - `data.queuedAt`) over UC19 decisions in the period that carry a queued time not after the decision; in hours with 2 decimals; 0 when there is none |
| R7 | Top contributors (L14): authors with the most public tours rated >= 4 on average (at least one rating), leaving out every author with a `hide_tour` action on any of their tours within the period; top 5, ties by higher average then author id; `averageRating` = mean over the qualifying tours |
| R8 | Snapshot numbers (not filtered by the period): `pendingReview` (tours in `pending_review` / `ai_warning` now), `openReportTours` (tours with open reports now). Period numbers: `averageReviewHours`, `reportedTours` (distinct tours with a report created in the period), `topContributors` (hide exclusion), `actionsByType` |
| R9 | No data -> zeros, `{}` and empty lists (E1) |
| R10 | Admin role only (`verifyJwt(['admin'])`): 401 without a valid token, 403 for another role |

## 3. Data (schema `tour`, additive)

```prisma
model Tour {
  // ...
  reviewQueuedAt DateTime? @map("review_queued_at") // last entry into pending_review / ai_warning
}

model AdminAction {
  // ... (UC20 columns)
  sourceKey String? @unique @map("source_key") // event-fed rows only (R4)
  @@index([action, createdAt])
}

model TourReport {
  // ...
  @@index([createdAt]) // reported tours in a period
}
```

`reviewQueuedAt` is written by the UC15 moderation result path (`tour.ai_passed`, with or without
`warning`) in the same conditional UPDATE as the status; this is the only path into the review queue
today. A UC19 decision copies it into the log row (`data.queuedAt`, read under the row lock of the
decision) so later numbers never depend on the tour row. Decisions logged before this change, or for
tours queued before the column existed, have no `queuedAt` and are left out of R6.

Push command for the merge (never run by the agent): `docker compose run --rm --no-deps tour sh -c
'export DATABASE_URL="${DATABASE_URL_DIRECT_TOUR:-$DATABASE_URL}"; npx prisma db push --skip-generate'`.

## 4. API (gateway `/api/tours/admin/...`, mounted after `/admin/reviews` and `/admin/reports`)

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| `GET` | `/dashboard` | `from`, `to` | `{ from, to, pendingReview: { pending_review, ai_warning, total }, averageReviewHours, reportedTours, openReportTours, topContributors: [{ authorId, publicTours, averageRating }], actionsByType: { <action>: n } }` |
| `GET` | `/actions` | `adminId`, `action`, `targetType`, `targetId`, `from`, `to`, `page` (>= 1), `limit` (1..100, default 20) | `{ items: [{ id, adminId, action, targetType, targetId, reason, data, createdAt }], page, limit, total }`, newest first |
| `GET` | `/actions/:id` | | one item; 404 `admin_action_not_found` |
| `GET` | `/users/:userId/violations` | | `{ userId, tours: { total, public, hidden, rejected }, hiddenTours: [{ id, title, hiddenAt, reason }], rejectedTours: [{ id, title, rejectedAt, reason }], reports: { open, dismissed, actioned }, accountActions: [item] }` |

`action` must be one of the known actions and `targetType` one of `tour | user` (400 otherwise).
`hiddenAt` is the time of the last `hide_tour` row, `rejectedAt` the time of the last UC19 rejection in
`tour_review_actions` (it also holds decisions older than the shared log); both lists keep 50 tours,
newest first. `reports` counts the reports received on the user's tours; `accountActions` are the
latest 20 log rows with target `user` and this id. Tour cannot tell whether an account exists (Auth
owns it), so an unknown user gets zeros. Messages are in Vietnamese; `sourceKey` is never returned.

## 5. Event consumed

| Event | Queue | Bound when | Row |
| --- | --- | --- | --- |
| `account.moderated` (existing, Auth) | `tour.admin-log` | the broker is loaded (`MODERATION_EVENTS_ENABLED` or `CHATBOT_EVENTS_ENABLED`) | R3, R4 |

With both flags off Tour has no broker connection and records no account action; the account
actions stay in Auth and Notification. No new event is published.

## 6. Layers

| Layer | Files (`services/tour/src`) |
| --- | --- |
| Domain | `domain/tour/admin-insights.js` (periods, R6, R7, source key), `domain/entities/admin-action.js` (new actions and maps) |
| Application | `application/use-cases/admin-insights.js` (`GetAdminDashboard`, `ListAdminActions`, `GetAdminAction`, `GetUserViolations`, `RecordAccountAction`), `dtos/admin-insight-schemas.js` |
| Infrastructure | `persistence/prisma-admin-insight-repository.js` (aggregates, schema-qualified raw SQL), `prisma-admin-action-repository.js` (`appendOnce`, `findById`, filters), `prisma-tour-repository.js` (R2, `reviewQueuedAt`) |
| Interfaces | `http/{controllers/admin-insight-controller.js,routes/admin-insight-routes.js}`, `events/account-moderated-handler.js` |

Raw SQL compares `timestamp(3)` UTC columns with bounds cast in SQL to UTC, so the numbers do not
depend on the session TimeZone.

## 7. Checks

`test/admin-dashboard.test.js` (in-memory fakes, shared zod contract for `account.moderated`, local
HTTP server with a stand-in guard). On a disposable PostGIS with session TimeZone `Asia/Ho_Chi_Minh`:
`prisma db push`, moderation result sets `review_queued_at`, a UC19 approval writes both log tables (a
failing log append rolls both back), dashboard numbers on seeded rows for two periods, duplicate and
concurrent `account.moderated` -> one row, log filters and paging, violation history.

## 8. Out of scope

Admin screens (dashboard, log, violation panel), charts over time, CSV export, recording the account
action in Tour when the broker is off, a backfill of `queuedAt` for old decisions.
