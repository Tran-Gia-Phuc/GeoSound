# UC17: tour statistics for the contributor (design)

Issue #271 (label `uc-later`). Use case: `docs/use case/lam-sau/UC17-thong-ke-danh-gia-tour.md`.
Step 1 (this note): backend in the Tour service. The client screen and the activity beacons in the
tour detail and player come in a later PR of the same issue.

## 1. Goal

The author of a tour (or an admin) sees views, plays, completions, downloads, the rating average and
star distribution and the latest comments, filtered by period and language. Tourists' apps send one
small "activity" event per action; anonymous visitors count too.

## 2. Rules

| # | Rule |
| --- | --- |
| S1 | Actions (AI_PLAN L11): `view` = tour detail opened, `play` = first stop started, `complete` = last stop ended, `download` = offline package saved |
| S2 | Actor: the account when a valid access token is present, else the client device id (`client/src/lib/device-id.js`, 8..100 characters, same shape as Auth's `deviceId`). An invalid or expired token falls back to the device id; no token and no device id -> 400 |
| S3 | One count per (tour, actor, action, language, UTC day): repeats the same day are ignored, the next UTC day counts again |
| S4 | Only `public` tours count. Any other status, or an unknown id, answers the same 204 and counts nothing (the status is never revealed) |
| S5 | At most 200 counted marks per actor per UTC day across all tours; beyond that, 204 without counting |
| S6 | No raw IP, user agent, account id or device id is stored: `actorKey = sha256(salt + "u:"/"d:" + id)`, salt from env `STATS_ACTOR_SALT` (optional, default a fixed string) |
| S7 | Statistics are read by the tour author (any status) or an admin; anyone else gets 403 `not_tour_owner` |
| S8 | Writes touch the statistics tables only; `tours.updated_at` (moderation and catalog revision) never moves |
| S9 | A tour without data answers zeros and empty arrays (E1: the client shows "Chưa có dữ liệu thống kê") |

## 3. Data (schema `tour`, additive)

```prisma
model TourDailyStat {            // table tour_daily_stats
  tourId String; day DateTime @db.Date; language String
  views Int @default(0); plays Int @default(0); completions Int @default(0); downloads Int @default(0)
  @@id([tourId, day, language])  // relation to Tour, onDelete: Cascade
}
model TourActivityMark {         // table tour_activity_marks (dedup)
  tourId String; actorKey String; action String; language String; day DateTime @db.Date
  createdAt DateTime @default(now())
  @@id([tourId, actorKey, action, language, day])
  @@index([actorKey, day])       // daily cap
  @@index([day])                 // purge
}
```

`Tour` only gets the back relations. The language of an event defaults to the tour's original language.

Write path: one SQL statement (so one transaction), schema-qualified through `schemaFromUrl` like the
UC05 aggregate:

```sql
WITH mark AS (
  INSERT INTO tour_activity_marks (tour_id, actor_key, action, language, day)
  SELECT $tour, $actor, $action, $lang, $day::date
   WHERE (SELECT count(*) FROM tour_activity_marks WHERE actor_key = $actor AND day = $day::date) < 200
  ON CONFLICT DO NOTHING RETURNING action)
INSERT INTO tour_daily_stats AS d (...) SELECT ... (action = 'view')::int, ... FROM mark
ON CONFLICT (tour_id, day, language) DO UPDATE SET views = d.views + EXCLUDED.views, ...
```

The counter moves only when the mark is new. Concurrent identical events wait on the mark's primary
key and then skip. The cap is checked in the same statement; two concurrent events of one actor at
the limit may both pass (at most a few marks over 200), which is accepted for an abuse limit.

Retention: marks older than 40 days are deleted by an hourly job in `src/index.js` (one minute after
start, then every hour, like Auth's session purge). Daily counters are kept.

## 4. API (gateway `/api/tours`)

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/:id/activity` | optional | `{ action, language?, deviceId? }` | 204 always (counted or not); 400 `validation_error` for a bad body or no actor |
| `GET` | `/mine/:id/stats` | contributor (own tour) or admin | `from`, `to` (`YYYY-MM-DD`, UTC), `language` | see below |

Period: default the last 30 days ending today (UTC), both ends included; `from` alone gives up to 30
days from it; at most 366 days; `from` after `to` -> 400.

```json
{ "tourId": "…", "from": "2026-10-06", "to": "2026-11-04", "language": null,
  "totals": { "views": 11, "plays": 2, "completions": 1, "downloads": 1, "completionRate": 0.5 },
  "daily": [{ "day": "2026-11-04", "views": 11, "plays": 2, "completions": 1, "downloads": 1 }],
  "ratings": { "averageRating": 4.6, "ratingCount": 128, "distribution": { "1": 0, "2": 0, "3": 1, "4": 0, "5": 1 } },
  "comments": { "items": [{ "id": "…", "userName": "An", "stars": 5, "comment": "…", "createdAt": "…" }], "total": 1 } }
```

- `daily` lists only days with data, oldest first, summed over languages unless `language` is set.
- `completionRate` = completions / plays, 0 without plays, capped at 1, 4 decimals.
- `averageRating` / `ratingCount` come from the tour row (they may include the seeded demo values, see
  `uc05-ratings.md` section 3); `distribution` counts the rating rows only. Ratings and comments have
  no language and are not filtered by period or language. `comments` = the 20 latest ratings with a
  comment, plus their total; never the reviewer's user id.

Mounting: the router is mounted next to the UC05 rating router, before the contributor routers. Those
apply `verifyJwt(['contributor'])` at router level on `/`, which would answer 401 to an anonymous
beacon and 403 to an admin. Guards are per route: `optionalAuth(verifyJwt())` for the beacon,
`verifyJwt(['contributor', 'admin'])` plus the ownership check in the use case for the stats.

## 5. Events

None.

## 6. Client (next PR)

Beacons: `view` on tour detail, `play` on the first stop, `complete` at the end of the last stop,
`download` after the offline package is saved (fire and forget, with `getDeviceId()`). Studio screen
"Thống kê" per tour: totals, daily chart, star distribution, comments, period and language filters.

## 7. Out of scope

Unique visitors over a period (marks are daily and purged), per-stop listening time, export, real-time
counters, IP-based limits (the gateway's global rate limit applies).
