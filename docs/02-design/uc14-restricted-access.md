# UC14: restricted access with a passcode (design)

Issue #269 (label `uc-later`). Use case: `docs/use case/lam-sau/UC14-truy-cap-han-che-passcode.md`.
Step 1 (this note): backend in the Tour service. The client screens (author settings, passcode dialog,
tester unlock screen) come in a later PR of the same issue.

## 1. Goal

An author lets a small group test a tour that the public cannot see yet, without an admin review. The
author sets a passcode; a signed-in tester enters it once and can then read, play and download the tour
until the author changes the passcode or turns restricted mode off (AI_PLAN L3, L9).

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Only the author (owner, role contributor) manages restricted mode; another account gets 403 `not_tour_owner` |
| R2 | Restricted mode is turned on from `draft`, `rejected` or `changes_requested` only. A `public` tour must be unpublished first; a tour in moderation (`ai_checking`, `ai_warning`, `pending_review`) must be edited back to draft first. Otherwise 409 `tour_not_restrictable` |
| R3 | E1: the passcode is trimmed, 6 to 32 characters, no whitespace inside; else 400 with a Vietnamese message |
| R4 | The passcode is stored only as a scrypt hash with a random salt (Node `crypto.scrypt`, no new dependency) and is never returned by any route |
| R5 | No admin review (UC14 rule): status goes straight to `restricted` |
| R6 | A1 change passcode: new hash, `passcode_version + 1`, every existing unlock stops working. A1 turn off: status `draft`, hash cleared, version + 1, unlocks and attempts deleted |
| R7 | Unlock needs a signed-in account (any role). Wrong code: 403 `wrong_passcode` ("Mã truy cập không đúng"). Not restricted or unknown: 404 |
| R8 | At most 5 wrong attempts per account and tour in 15 minutes; then 429 `too_many_attempts`, even with the right code, until the window moves on |
| R9 | The unlock is kept per account (`tour_access_grants`) and is valid only while its version equals the tour's `passcode_version` |
| R10 | A restricted tour is never public: it never appears in search, nearby / explore, ratings, reports, and is never sent in `tour.published` (D25 sends public tours only) |
| R11 | Status writes bump `tours.updated_at` normally; unlock and attempt bookkeeping never touch the `tours` row |

## 3. Status and the other flows

- `Tour.LIVE_STATUSES` is now `public` only (it held `restricted` before). Editing a restricted tour keeps
  it restricted: testers see the new content, nothing is sent to moderation or to the catalog.
- Submit for review (UC15) or direct publish of a restricted tour answers 409 `tour_restricted`
  ("hãy tắt chế độ này trước khi gửi duyệt"). Safe option chosen: the author turns restricted mode off
  first (back to `draft`, testers lose access), then submits. Readiness shows `canPublish: false`.
- Place moderation (`place.submitted`) runs for places of a restricted tour exactly as for a draft tour:
  it is per place, harmless, and the result is ready when the tour is later submitted.
- `notifyTourPublished` already returns early for a non-public tour; `publicWhere`, `findPublicById`,
  `findManyByIds` and `publicPlaceWhere` filter on `status = 'public'`. Tests cover all of them.
- Admin hide (UC20) and admin review (UC19) never apply to a restricted tour (not public, not reviewable).

## 4. Data (schema `tour`, additive)

```prisma
model Tour {
  // ...
  passcodeHash    String?   @map("passcode_hash")      // "scrypt$N$r$p$salt$key"
  passcodeVersion Int       @default(0) @map("passcode_version")
  passcodeSetAt   DateTime? @map("passcode_set_at")
}
model TourAccessGrant {      // tour_access_grants, unique (tour_id, user_id), FK cascade
  id, tourId, userId, passcodeVersion, createdAt
}
model TourUnlockAttempt {    // tour_unlock_attempts, index (tour_id, user_id, created_at), FK cascade
  id, tourId, userId, createdAt
}
```

The rate limit is kept in the database (no new Redis use in Tour). An unlock inserts one attempt row
first, then counts the rows of the account and tour in the last 15 minutes (this one included): more
than 5 refuses with 429 and deletes the row (a refused request does not extend the lock); a right code
deletes the row (only failures count); a wrong code keeps it. Each insert commits on its own, so
concurrent requests count each other: checked on a disposable PostGIS, 12 concurrent wrong codes of one
account gave 5 checks (403) and 7 refusals (429).

Turning on and changing the passcode is one conditional `UPDATE ... WHERE id AND status IN (...)` plus
`DELETE FROM tour_access_grants` in one transaction; 0 rows means the status moved (409).

## 5. API (gateway `/api/tours`)

| Method and path | Who | Answer |
| --- | --- | --- |
| `GET /mine/:tourId/access` | owner | `{ restricted, passcodeSetAt, testers }` (testers = valid unlocks) |
| `PUT /mine/:tourId/access` `{ passcode }` | owner | turn on or change: `{ restricted: true, passcodeSetAt, testers, changed: 'enabled' \| 'passcode' }`; 400, 403, 409 |
| `DELETE /mine/:tourId/access` | owner | turn off: `{ tour }` (status `draft`); 409 `tour_not_restricted` |
| `POST /:id/unlock` `{ passcode }` | signed in | `{ unlocked: true }`; 403 `wrong_passcode`, 404, 429 `too_many_attempts` |
| `GET /:id/access/mine` | signed in | `{ unlocked }` (the owner is always unlocked); 404 when not restricted |
| `GET /:id/restricted?lang=` | owner or unlocked tester | `{ tour }`: the same view as the public detail (`buildTourDetailView`, stops in the player shape) plus `restricted: true`; others 404 |

The router (`tour-access-routes.js`) gets `requireAuth` and `requireContributor` injected (shared
`verifyJwt`), and is mounted before the contributor routers so a tourist tester is not answered 403.
Offline download (L9, built 2026-11-08): `GET /:id/restricted/package?lang=` (tester guard) runs
`GetRestrictedTourPackage`: the same access check as `GetRestrictedTour`, then `buildTourPackage()`
(shared with the public UC03 `GetTourPackage`), answer = UC03 package + `restricted: true`. The public
`GET /:id/package` still serves public tours only. The client shows `OfflineDownload` on the restricted
view, stores `restricted: true` with the package, sends no UC17 `download` beacon, and the library
checks for a newer revision through the restricted route. A package already stored stays playable
offline after a passcode change; updating it then answers 404.

## 6. Code

| Layer | File |
| --- | --- |
| Domain | `domain/entities/tour.js` (`isRestricted`, `canRestrict`, `RESTRICTABLE_STATUSES`), `domain/tour/restricted-access.js`, `domain/errors/index.js`, `domain/ports/index.js` |
| Application | `application/use-cases/tour-access.js`, `publish-tour.js` (409 `tour_restricted`), `dtos/access-schemas.js` |
| Infrastructure | `persistence/prisma-tour-access-repository.js`, `security/scrypt-passcode-hasher.js` |
| Interfaces | `controllers/tour-access-controller.js`, `routes/tour-access-routes.js`, wiring in `container.js` / `index.js` |
| Tests | `test/tour-restricted-access.test.js` |

## 7. Schema push

Tour does not push on start. After the merge the user runs:
`docker compose run --rm --no-deps tour sh -c 'export DATABASE_URL="${DATABASE_URL_DIRECT_TOUR:-$DATABASE_URL}"; npx prisma db push --skip-generate'`
