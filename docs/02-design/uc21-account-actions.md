# UC21: admin account actions (design)

Issue #274 (label `uc-later`). Use case: `docs/use case/lam-sau/UC21-quan-ly-tai-khoan-vi-pham.md`.
Step 1 (this note): backend in Auth (search, actions, sign-in checks), the `account.moderated` event
and its Notification consumer. The admin screens come in a later PR. The action log row in Tour
(`admin_actions`, UC22, AI_PLAN L14) consumes the same event later and is not part of this step.

## 1. Goal

An admin finds an account, sees its state, and warns, suspends (for a while), bans or restores it.
The user is signed out at once when suspended or banned, cannot sign in while restricted, and is told
by email and by an in-app notification.

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Admin only: Auth routes under `/admin/users` (gateway `/api/auth/admin/users`), `verifyJwt(['admin'])` like `/admin/sessions` (L4) |
| R2 | Actions: warn (no status change), suspend, ban, restore (A1). A reason is required for warn, suspend and ban (trimmed, 1..1000); restore takes an optional reason. Invalid bodies answer 422 `validation_error`, like UC19 |
| R3 | Suspension (L13): preset 1, 7 or 30 days from now, or an end date (`until`, ISO 8601 with time and offset) in the future and at most 365 days ahead. Exactly one of `days` / `until` |
| R4 | An admin never acts on their own account (403 `self_action`) nor on another admin (403 `target_is_admin`). Unknown account: 404 `user_not_found` "Không tìm thấy tài khoản" (E1) |
| R5 | Status values `active`, `suspended`, `banned`. A suspension whose end passed counts as active: checked lazily at sign-in and refresh and shown as `active` by the API; nothing rewrites the row |
| R6 | Suspended: sign-in and refresh answer 403 `account_suspended` "Tài khoản đang bị tạm khoá đến <giờ Việt Nam>", with `details.suspendedUntil` (ISO). Banned: unchanged (403 `account_banned`, UC01 E3) |
| R7 | Suspend and ban sign the user out of every device at once with `RevokeAllSessions` (UC23 R7): revoke reason `suspended` or `banned`, `sid` marked in Redis |
| R8 | A suspended account can be suspended again (new end replaces the old one) or banned. Warn, suspend and ban of a banned account: 409 `account_already_banned`. Restore of an active account (or of an ended suspension): 409 `account_not_restricted` |
| R9 | Conditional writes: the status write matches the status and end date that were read (`updateMany`); of two admins acting at once only one wins, the other gets 409 `account_state_changed` |
| R10 | Warnings never escalate automatically (L13); counting warnings is UC22's log |

## 3. Data (schema `auth`)

One additive nullable column on `users`: `suspendedUntil DateTime? @map("suspended_until")`. The
existing `status` column gets the value `suspended`; `ban_reason` keeps the reason of the current
suspension or ban and is cleared on restore. Session `revoke_reason` gets the value `suspended`.

`PrismaUserRepository.save` (sign-in lockout counter, password changes) no longer writes `status` or
`ban_reason`: only `updateStatusIf` changes them, so a failed sign-in that saves its counter cannot undo
a ban made at the same moment.

## 4. API (gateway `/api/auth`)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| `GET` | `/admin/users` | `q` (email or full name, case-insensitive contains, max 200), `role`, `status` (effective), `page` (1..), `limit` (1..50, default 20) | `{ items, total, page, limit }`, newest account first |
| `GET` | `/admin/users/:id` | | item + `activeSessions` (signed-in devices) |
| `POST` | `/admin/users/:id/warn` | `{ reason }` | `{ message, action, user }` |
| `POST` | `/admin/users/:id/suspend` | `{ reason, days: 1 \| 7 \| 30 }` or `{ reason, until }` | `{ message, action, user, sessionsRevoked }` |
| `POST` | `/admin/users/:id/ban` | `{ reason }` | `{ message, action, user, sessionsRevoked }` |
| `POST` | `/admin/users/:id/restore` | `{ reason? }` | `{ message, action, user }` |

Item: `{ id, email, fullName, role, status, banReason, suspendedUntil, createdAt }`, never the
password hash, OTP or sign-in lock data. `banReason` and `suspendedUntil` are null while active.
Errors: 400 bad query, 401 / 403 from the guard, 403 `self_action` / `target_is_admin`, 404
`user_not_found`, 409 `account_already_banned` / `account_not_restricted` / `account_state_changed`,
422 `validation_error` (reason, days, end date).

## 5. Event `account.moderated` (Auth -> Notification, later Tour for UC22)

```json
{ "userId": "u1", "action": "suspend", "reason": "Spam", "until": "2026-11-10T03:00:00Z",
  "adminId": "a1", "email": "an@mail.com", "fullName": "Nguyễn An", "at": "2026-11-03T03:00:00Z" }
```

Additive (`EVENTS.ACCOUNT_MODERATED`, zod in `shared/events`): `action` in `warn | suspend | ban |
restore`; `reason` required except for restore; `until` present only for suspend; `at` ends with `Z`.
Published after the write and the sign-out; a failed publish (or a failed sign-out) is only logged.

## 6. Notification

- Email to `email` (no `SECURITY_ALERT_TO` override): "Tài khoản GeoSound của bạn nhận một cảnh báo",
  "... bị tạm khoá đến <giờ>", "... đã bị cấm", "... đã được khôi phục", with the reason and the time.
- In-app notification for `userId`: type `account.moderated`, title per action, body = reason,
  `data = { action, until? }`, no `tourId`. Source key `account.moderated:<userId>:<sha256>`, so a
  redelivered event adds no row. Stored before the email; SMTP errors behave like the tour emails.

## 7. Checks

Auth use cases and routes with in-memory fakes (payloads validated with the shared zod), shared event
test, Notification tests per action. On a disposable Postgres: `prisma db push`, search (case-insensitive,
effective status, paging), suspend then restore, two concurrent bans -> 200 and 409
`account_state_changed`.

## 7a. Violation history (UC21 step 2)

Served by Tour, not Auth: `GET /api/tours/admin/users/:userId/violations` (tours by status, hidden and
rejected tours, reports received on the author's tours, latest account actions). Tour also records
every `account.moderated` event in its admin log (queue `tour.admin-log`). See
[uc22-dashboard-log.md](uc22-dashboard-log.md) sections 4 and 5.

## 8. Out of scope

Admin screens (next PR), the UC22 log row and the violation history shown in UC21 step 2 (needs the
UC22 log and Tour data), automatic escalation, appeals, deleting accounts.
