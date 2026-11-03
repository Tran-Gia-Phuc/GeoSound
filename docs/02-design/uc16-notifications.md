# UC16: contributor status and in-app notifications (design)

Issue #270 (label `uc-later`). Use case: `docs/use case/lam-sau/UC16-theo-doi-trang-thai-thong-bao.md`.
Step 1 (this note): backend in the Notification service, plus the gateway route. The client screens
(notification centre, unread badge, status column) come in a later PR of the same issue.

## 1. Goal

A contributor sees, in the app, what happened to their tours: AI rejection, admin approval, rejection or
change request, hiding, visitor reports, and the narration audio being ready, always with the concrete
reason when there is one. Notification already consumes these events to send emails; it now also stores
one in-app notification per event and serves them over HTTP. Decisions: AI_PLAN Q7 (in-app plus the
existing email, no web push) and Q8 (Notification gets its own HTTP port).

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Every route needs a signed-in user of any role (AI_PLAN L3); a user only reads and marks their own notifications. Another user's or an unknown id answers 404 |
| R2 | The recipient of a tour event is `contributorId` (the tour author). An event without `contributorId` is stored for nobody; its email logic is unchanged |
| R3 | A notification carries the concrete reason when the event has one (`reason` of report, AI rejection, rejection, change request, hide) in `body`, plus whitelisted extras in `data` |
| R4 | Never stored: reporter identity, emails, admin ids, any payload key outside the whitelist |
| R5 | A redelivered event creates no duplicate (unique `source_key`) |
| R6 | Storing never throws: shared `consume()` nacks a throwing handler without requeue, so a throw would retry nothing and would only stop the email. A storage failure is logged; the email still goes out |
| R7 | The in-app row is written before the email, so an SMTP failure (which still propagates as before) does not lose it |
| R8 | Email behaviour is exactly as before (templates, recipients, `tour.reported` has no email) |
| R9 | Tokens of signed-out sessions are refused, with the same Redis revocation check as media (UC23) |

## 3. Data (schema `notification`)

```prisma
model InAppNotification {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  type      String                        // event name, e.g. "tour.rejected"
  tourId    String?   @map("tour_id")
  title     String                        // short Vietnamese sentence
  body      String?                       // reason text (max 1000)
  data      Json      @default("{}")
  readAt    DateTime? @map("read_at")
  createdAt DateTime  @default(now()) @map("created_at")
  sourceKey String    @unique @map("source_key")

  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@map("in_app_notifications")
}
```

Additive: one new table. The placeholder model `Notification` (`notifications`) is kept untouched (it may
already exist in the shared database).

| Event | Title (with «tour title», else "Tour của bạn ...") | `body` | `data` |
| --- | --- | --- | --- |
| `tour.ai_rejected` | Tour «X» không qua kiểm duyệt tự động | `reason` | `reasons[{field, category, message}]` (max 20) |
| `tour.approved` | Tour «X» đã được duyệt | | |
| `tour.rejected` | Tour «X» bị từ chối | `reason` | |
| `tour.changes_requested` | Tour «X» cần chỉnh sửa | `reason` | |
| `tour.hidden` | Tour «X» đã bị ẩn | `reason` | |
| `tour.reported` | Tour «X» bị khách báo cáo | `reason` (optional) | `count`, `flagged` (optional) |
| `tts.render.completed` | Thuyết minh của tour «X» đã sẵn sàng | | `languages` |

`source_key` = `<event>:<tourId>:<sha256 of the event name and the payload with sorted keys>`. A
redelivery has the same payload (same `at`), so the same key; a new event has a new `at` (or a new
`count`). The insert is `createMany(..., skipDuplicates: true)` (`ON CONFLICT DO NOTHING`), so concurrent
deliveries never raise a unique error. Mark read is a conditional `updateMany` on
`(id, user_id, read_at IS NULL)`.

Checked on a disposable Postgres 16: the same event stored 10 times concurrently gives 1 row; list,
paging, unread filter, unread count, mark read (another user's id: 404) and read-all per user.

Schema push (by hand, never on start; the Notification container does not run `prisma db push`):
`docker compose run --rm --no-deps notification sh -c 'export DATABASE_URL="${DATABASE_URL_DIRECT_NOTIFICATION:-$DATABASE_URL}"; npx prisma db push --skip-generate'`

## 4. API (gateway `/api/notifications`, Notification HTTP port 3006)

| Method | Path | Query / body | Response |
| --- | --- | --- | --- |
| `GET` | `/` | `page` (1..), `limit` (1..50, default 20), `unread=true\|false` | `{ items: [{ id, type, tourId, title, body, data, read, createdAt }], page, limit, total, unread }`, newest first; `total` follows the filter, `unread` is the user's unread count |
| `GET` | `/unread-count` | | `{ unread }` |
| `POST` | `/:id/read` | | 204 (also when already read) |
| `POST` | `/read-all` | | `{ updated }` |
| `GET` | `/health` | | `{ status: 'ok', service: 'notification' }` (not routed by the gateway) |

Errors: 401 without or with an invalid / revoked token, 400 `validation_error` ("Tham số không hợp lệ")
for a bad query, 404 `notification_not_found` ("Không tìm thấy thông báo") for another user's, unknown or
malformed id.

## 5. Events

No contract change. Notification keeps its queue `notification.events` and bindings. A parallel task adds
optional `reason`, `flagged`, `contributorId`, `tourTitle` to `tour.reported`; they are all read as
optional here. `auth.new_device_login` stays email only.

## 6. Wiring

- `services/notification`: `src/index.js` starts Express on `PORT` (3006) and the RabbitMQ worker with
  retry (a broker outage no longer stops the HTTP part); only `index.js` imports `../shared`.
  Layers: `domain/in-app-notification.js` (pure mapping), `application/` (store, list, count, read),
  `infrastructure/prisma-in-app-notification-repository.js`, `interfaces/http/` (controller, routes),
  `container.js`. The Dockerfile installs Prisma and generates the client like Tour.
- Gateway: `TARGETS.notification` = `NOTIFICATION_SERVICE_URL` (default `http://notification:3006`),
  `mount('/api/notifications', ...)`.
- Compose: `notification` gets `PORT: 3006` and depends on Redis; no host port.
- `.env.example`: `NOTIFICATION_SERVICE_URL=http://notification:3006`.

## 7. Client (next PR)

Notification centre (list, unread filter, open a notification to read the reason, mark all read), unread
badge in the menu, tour status column in Studio; empty state for E1.

## 8. Out of scope

Web push (A1, later), deleting notifications, notifications for tourists, email preferences, real-time
delivery (the client polls the unread count).
