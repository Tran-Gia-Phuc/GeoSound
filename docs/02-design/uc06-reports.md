# UC06: report a tour (design)

Issue #268 (label `uc-later`). Use case: `docs/use case/lam-sau/UC06-bao-cao-tour.md`.
Step 1 (this note): backend in the Tour service and an additive change of the `tour.reported` event.
The client screen (report button and form on tour detail and in the player) comes in a later PR of the
same issue. The admin report queue is UC20 (later task).

## 1. Goal

A signed-in user reports a public tour with a reason from a list (tier 3 of moderation, community
report). Reports from 5 distinct accounts within 7 days put the tour in the admin report queue (UC20);
the tour stays public and playable.

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Reporting needs a signed-in account (any role) (E1); only `public` tours can be reported, other statuses answer 404 `tour_not_found` like the public detail |
| R2 | One report per account and tour; a second one answers 409 `already_reported` (the client shows an "already reported" state) |
| R3 | Reason required (E2: "Vui lòng chọn lý do báo cáo"): `false_info`, `offensive`, `spam`, `copyright`, `other`. The note is optional, trimmed, at most 500 characters, and required for `other` ("Vui lòng mô tả lý do") |
| R4 | The author cannot report their own tour (403 `own_tour`) |
| R5 | When reports from 5 distinct accounts with status `open` were created within the last 7 days, `tours.report_flagged_at` is set (only when null). Nothing is hidden automatically (A1, "không ẩn hẳn") |
| R6 | A report has a `status` for UC20: `open` (default), `dismissed`, `actioned`; only `open` reports count for R5 and for `open_report_count` |
| R7 | The reporter identity is never exposed to the contributor (not in the event, not in any contributor view) |
| R8 | `tour.reported` is published after the commit when the broker is loaded; a failed publish is only logged, never fails the request |

## 3. Data (schema `tour`)

```prisma
model TourReport {
  id         String   @id @default(uuid())
  tourId     String   @map("tour_id")
  reporterId String   @map("reporter_id")
  reason     String                         // R3
  note       String?
  status     String   @default("open")      // R6
  createdAt  DateTime @default(now()) @map("created_at")
  tour       Tour     @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@unique([tourId, reporterId])
  @@index([tourId, status, createdAt])
  @@map("tour_reports")
}
```

Additive: one new table; `Tour` gets `reportFlaggedAt DateTime? @map("report_flagged_at")`,
`openReportCount Int @default(0) @map("open_report_count")` (sort key of the UC20 queue) and the back
relation `reports`.

Write path (one transaction): lock the tour row (`SELECT ... FOR UPDATE`), insert the report, count the
distinct reporters of open reports created since now - 7 days (the new row included), then one raw
`UPDATE tours SET open_report_count = open_report_count + 1, report_flagged_at = CASE WHEN report_flagged_at IS NULL AND <reached> THEN now() ELSE report_flagged_at END`.
The lock serialises reports of one tour, so concurrent reports cannot both miss the threshold, and a
second report of the same account waits and then hits the unique key (P2002 -> 409). Raw SQL is used
so `tours.updated_at` (moderation and catalog revision) never moves.

Checked on a disposable PostGIS: 7 accounts at once give 7 rows, `open_report_count` 7, exactly one
flag time (set by the 5th) and an unchanged `updated_at`; one account 3 times at once gives 1 row and
two 409; reports older than 7 days and dismissed reports do not count.

## 4. API (gateway `/api/tours`, mounted before the contributor routers)

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/:id/reports` | signed in | `{ reason, note? }` | 201 `{ report: { id, reason, note, createdAt }, flagged }` |
| `GET` | `/:id/reports/mine` | signed in | | `{ report: { reason, note, createdAt } \| null }` |

`flagged` is true when the tour is in the review queue after this report. Errors: 400
`validation_error` (R3), 401 without a token, 403 `own_tour` (R4), 404 `tour_not_found` (R1), 409
`already_reported` (R2).

## 5. Events

`tour.reported` (Tour -> broker), extended additively in `shared/events/index.js`:
`{ tourId, count, reason?, flagged?, contributorId?, tourTitle?, at? }`, where `count` is the open
report count after this report. No reporter id (R7). Notification already receives it and sends no email
(no template: internal signal for the admin side). Nothing is sent to the chatbot index.

## 6. Client (next PR)

"Báo cáo" button on tour detail (UC02) and in the player, reason form with the note box, sign-in
prompt for guests (E1), "Đã gửi báo cáo, cảm ơn bạn" and the "already reported" state.

## 7. Out of scope

Admin report queue and decisions (UC20), withdrawing or editing a report, reports on places or
ratings, automatic hiding.
