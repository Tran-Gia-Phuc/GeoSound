# Admin review API (UC19, issue #243)

Tier 2 of moderation: an admin reviews tours that passed the AI step and decides. Backend only, in
the Tour service (decision D27). The admin screens are Frontend A issues #121 to #126.

## Statuses

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `ai_warning` | AI passed with a warning, waits for an admin (shown first in the queue) | Tour, from `tour.ai_passed` with `warning: true` |
| `pending_review` | AI passed, waits for an admin | Tour, from `tour.ai_passed` |
| `public` | Approved, visible in search (UC02) and downloadable (UC03) | Admin approve |
| `rejected` | Rejected with a reason; the author may edit and submit again | Admin reject |
| `changes_requested` | New. Admin asked for changes; not live; the author edits and submits again (UC15) | Admin request changes |

An admin decides only from `ai_warning` or `pending_review`. The write is conditional
(`UPDATE ... WHERE id = ? AND status IN ('ai_warning', 'pending_review')`); any other status, or a
concurrent write that changed the status first, returns 409. Admins never change tour content.

`changes_requested` is in the author's "publishable from" set, so the author's publish / submit
action (UC09 A3, UC15) works from it like from `rejected`.

## Endpoints

All routes need a JWT with role `admin` (401 without a valid token, 403 for another role).
Service path `/admin/reviews`, gateway path `/api/tours/admin/reviews`. `:tourId` is a UUID (400 otherwise).

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /admin/reviews` | | `{ tours: [...] }`: `ai_warning` first, then oldest first (by `updatedAt`, the time the AI result arrived). Each item: `id, title, coverImageUrl, originalLanguage, type, city, status, aiWarning, authorId, moderationReasons, submittedAt`. Empty list when nothing waits (E1) |
| `GET /admin/reviews/:tourId` | | Read-only dossier: `tour` (with `moderationReasons`, `reviewReason`, `aiWarning`), `reviewable`, `places` (by `sequence`, with `images`, `audioUrl`, `moderationStatus`, `moderationReasons`), `routeConfig` (or null), `history` (decisions, newest first). 404 for an unknown tour |
| `POST /admin/reviews/:tourId/approve` | | Status `public`, `reviewReason` cleared. 404 / 409 |
| `POST /admin/reviews/:tourId/reject` | `{ "reason": "..." }` | Status `rejected`, reason stored in `reviewReason`. 422 without a reason. 404 / 409 |
| `POST /admin/reviews/:tourId/request-changes` | `{ "reason": "..." }` | Status `changes_requested`, reason stored in `reviewReason`. 422 without a reason. 404 / 409 |

`reason` is trimmed and must be 1 to 1000 characters. A decision returns
`{ message, tour, action }`, where `action` is `approve`, `reject` or `request_changes`.

## Decision log

Table `tour_review_actions` (model `TourReviewAction`), read by UC22:
`id, tour_id, admin_id, action, reason, from_status, created_at`, indexes on `(tour_id, created_at)`
and `created_at`. The row is written in the same transaction as the status change, only when the
conditional update wins. `tour_id` has no foreign key, so the log survives the deletion of a tour.

The `tours` table also gets `review_reason` (nullable): the last reject / change-request reason
shown to the author. Both changes are additive.

## Events

Sent after the write. When the broker is not loaded (`MODERATION_EVENTS_ENABLED` and
`CHATBOT_EVENTS_ENABLED` both off) nothing is sent. A publish failure is logged and never fails
the request.

| Decision | Event | Payload | Consumer |
| --- | --- | --- | --- |
| approve | `tour.approved` | `tourId, adminId, contributorId, tourTitle, at` | Notification (email) |
| approve | `tour.published` | full public tour (see `chatbot-architecture.md`), only with `CHATBOT_EVENTS_ENABLED=true` | AI chatbot indexer |
| reject | `tour.rejected` | `tourId, reason, contributorId, tourTitle, at` | Notification (email with reason) |
| request changes | `tour.changes_requested` (new) | `tourId, reason (1..1000), contributorId, tourTitle, at` | Notification (email "Tour cần chỉnh sửa" with reason) |

`tour.changes_requested` is added to `shared/events/index.js` (additive). Tour does not know the email, so these events
carry `contributorId` only; Notification looks the email up in Auth (`GET /internal/users/:id/contact`,
header `x-internal-token`, #258) and skips the email when the lookup fails.
