# UC20: admin handling of reported tours (design)

Issue #273 (label `uc-later`). Use case: `docs/use case/lam-sau/UC20-xu-ly-bao-cao-vi-pham.md`.
Step 1 (this note): backend in the Tour service, a new append-only admin action log and the additive
event `tour.restored`. The admin screens come in a later PR. It builds on the UC06 report model
(`uc06-reports.md`) and follows the UC19 admin API style (`admin-review-api.md`).

## 1. Goal

An admin sees the tours that guests reported, reads the reports of one tour and decides: hide the tour
(the author is warned with the reason), dismiss the reports (no violation, the tour stays public), or
restore a hidden tour to public (report bomb). Every decision is logged (UC22). Account actions after
repeated violations are UC21 (A3).

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Queue = tours with `open_report_count > 0`, sorted by `open_report_count` desc, then flagged first (`report_flagged_at` not null, UC06 R5), then the oldest open report first, then the id. Paged: `page` >= 1, `limit` 1..50 (default 20). No reported tour -> empty list (E1) |
| R2 | Admin role only (`verifyJwt(['admin'])`): 401 without a valid token, 403 for another role. Admins see the reporter id of each report; the contributor never does (UC06 R7) |
| R3 | Hide only from `public` (409 `tour_not_hideable`); reason required, trimmed, 1..1000 characters (422). Status -> `hidden`, open reports -> `actioned`, `open_report_count` = 0, `report_flagged_at` = null |
| R4 | Restore only from `hidden` (409 `tour_not_restorable`); reason optional. Status -> `public` straight away: no new moderation, no appeal (decision L13). Report rows are not changed |
| R5 | Dismiss only when the tour has open reports (409 `no_open_reports`); reason optional. Open reports -> `dismissed`, counters reset, status unchanged. Raw SQL so `tours.updated_at` (moderation and catalog revision) does not move |
| R6 | Each decision is ONE transaction: conditional write on the tour row, report rows, one `admin_actions` row. Two admins acting at once: exactly one wins, the other gets 409 |
| R7 | Events are published after the commit; a failed publish is logged and never fails the request (as in UC19) |

A report created while a hide commits is serialised by the tour row lock (UC06) and may land on the
hidden tour as a new open report; it then shows in the queue and can be dismissed.

## 3. Data (schema `tour`)

New append-only log, shared with UC21 (account actions) and read by UC22 (decision L14):

```prisma
model AdminAction {
  id         String   @id @default(uuid())
  adminId    String   @map("admin_id")
  action     String                          // hide_tour | restore_tour | dismiss_reports (UC21 adds more)
  targetType String   @map("target_type")    // tour | user
  targetId   String   @map("target_id")      // soft reference, no FK
  reason     String?
  data       Json     @default("{}")         // e.g. { fromStatus, reportCount }
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([targetType, targetId, createdAt])
  @@index([createdAt])
  @@index([adminId, createdAt])
  @@map("admin_actions")
}
```

Additive: one new table, no change to existing columns. The repository
(`PrismaAdminActionRepository`) only has `append` (inside the caller's transaction) and the list methods
`listByTarget` / `listRecent`: no update, no delete; the entity is frozen. UC19 keeps writing
`tour_review_actions` unchanged.

`data` per action: hide `{ fromStatus: 'public', reportCount }`, restore `{ fromStatus: 'hidden' }`,
dismiss `{ status, reportCount }` (`reportCount` = reports closed by the action).

Checked on a disposable PostGIS: queue order with real rows (6 flagged > 3 flagged > 3 older > 3 newer,
tour without reports left out, paging); two hides at once give one success, one 409 and one log row;
two dismisses at once give one success and one 409; dismiss leaves `updated_at` unchanged and clears
the flag; restore puts the tour back to public and a second restore answers 409.

## 4. API (gateway `/api/tours/admin/reports`, mounted next to `/admin/reviews`)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/` | `?page&limit` | `{ tours: [{ tourId, title, status, authorId, openReportCount, flagged, flaggedAt, lastReportAt, reasons: { <reason>: count } }], page, limit, total }` |
| `GET` | `/:tourId` | | `{ tour: { id, title, description, status, authorId, city, averageRating, ratingCount }, reports: { openReportCount, flagged, flaggedAt, open: [{ id, reporterId, reason, note, createdAt }], dismissedCount, actionedCount }, actions: { hide, restore, dismiss }, history: [AdminAction] }` |
| `POST` | `/:tourId/hide` | `{ reason }` | `{ message, tour, action: 'hide_tour', closedReports }` |
| `POST` | `/:tourId/restore` | `{ reason? }` | `{ message, tour, action: 'restore_tour' }` |
| `POST` | `/:tourId/dismiss` | `{ reason? }` | `{ message, tourId, status, action: 'dismiss_reports', dismissedReports }` |

Open reports and history are newest first. `actions` tells the client which buttons apply now; the
writes check again. Errors: 400 for a bad UUID or query, 401 / 403 (R2), 404 `tour_not_found`, 409
(R3 to R5), 422 for a missing or too long reason. Messages are in Vietnamese.

## 5. Events

| Decision | Event | Payload | Consumer |
| --- | --- | --- | --- |
| hide | `tour.hidden` (existing) | `tourId, reason, contributorId, tourTitle, at` | Notification (email with the reason, template exists) |
| hide | `tour.unpublished` reason `hidden` | as #240, only with `CHATBOT_EVENTS_ENABLED=true` | AI chatbot indexer |
| restore | `tour.restored` (new, additive) | `tourId, reason? (1..1000), contributorId?, tourTitle?, at?` | Notification: in-app notice and email to the author (updated 2026-11-08) |
| restore | `tour.published` | full public tour, as a UC19 approval | AI chatbot indexer |
| dismiss | none | | |

No event carries a reporter id. Nothing is sent when the broker is not loaded (both event flags off).

## 6. Client (next PR)

"Tour bị báo cáo" page (queue with count, flag, reasons), dossier page with the tour preview, the
reports and the history, and hide / restore / dismiss dialogs (`ConfirmDialog`, reason box).

## 7. Out of scope

Account actions (UC21), the UC22 dashboard and log screen, a Notification template for
`tour.restored`, automatic hiding, appeals by the author.
