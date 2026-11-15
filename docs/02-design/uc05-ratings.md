# UC05: tour rating and review (design)

Issue #267 (label `uc-later`). Use case: `docs/use case/lam-sau/UC05-danh-gia-tour.md`.
Step 1 (this note): backend in the Tour service, plus one additive claim in Auth tokens. The client screens
(#105, #162, #163) come in a later PR of the same issue.

## 1. Goal

A signed-in user gives a public tour 1 to 5 stars and an optional comment, can edit or delete it, and
everyone sees the tour average, the count and the comments. Ratings feed UC17 (statistics).

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Rating needs a signed-in account (any role); reading ratings is public (AI_PLAN L3) |
| R2 | One rating per account and tour; a second submit edits the first (UC05 business rule, A1) |
| R3 | Stars are required, integer 1..5 (E2: "Vui lòng chọn số sao"); the comment is optional, trimmed, at most 1000 characters |
| R4 | Only `public` tours can be rated or have their ratings listed; other statuses answer 404 like the public detail |
| R5 | The author cannot rate their own tour (403 `own_tour`) |
| R6 | Rating is allowed at any time (no need to play the tour first, Q1); no photos (Q2); comments are not sent to the AI moderation, abuse goes through reports (UC06, Q3) |
| R7 | `tours.average_rating` and `tours.rating_count` always reflect every change, updated atomically with the rating row; the tour `updated_at` (moderation and catalog revision) is not touched |
| R8 | A comment shows the reviewer's display name (snapshot at the time of the rating), never the email or the user id |

## 3. Data (schema `tour`)

```prisma
model TourRating {
  id        String   @id @default(uuid())
  tourId    String   @map("tour_id")
  userId    String   @map("user_id")
  userName  String   @map("user_name")   // display name snapshot (R8)
  stars     Int                          // 1..5
  comment   String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  tour      Tour     @relation(fields: [tourId], references: [id], onDelete: Cascade)

  @@unique([tourId, userId])
  @@index([tourId, createdAt])
  @@index([userId])
  @@map("tour_ratings")
}
```

Additive: one new table; `Tour` gets the back relation `ratings` only (no new column).

Aggregate update (R7): one SQL statement per change inside the same transaction as the rating row,
`UPDATE tours SET rating_count = rating_count + dc, average_rating = (average_rating * rating_count + ds) / (rating_count + dc)`
(0 when the count reaches 0), where `dc` / `ds` are the count and star-sum deltas (create +1 / +stars,
edit 0 / new - old, delete -1 / -stars). Each write first locks the caller's rating row
(`SELECT ... FOR UPDATE`), so concurrent submits of one account run one after the other, and the row
lock of the tour UPDATE serialises ratings of one tour. When two first submits of one account race on
the unique key, the loser retries once and edits. Raw SQL is used so `tours.updated_at` (moderation and
catalog revision) never moves. Checked on a disposable PostGIS: 20 users at once, 5 submits and 5
deletes of one account at once, 10 concurrent edits: count and average always equal the rows.

The demo values already seeded in `average_rating` / `rating_count` are kept as a starting point (user
decision 2026-11-03; they have no rating rows), so 4.6 / 128 plus one 5-star rating gives about
4.603 / 129. The star distribution (UC17) is computed from the rows only.

## 4. API (gateway `/api/tours`, mounted before the contributor routers)

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/:id/ratings` | none | `page` (1..), `limit` (1..50, default 10) | `{ summary: { averageRating, ratingCount, distribution: {1..5: n} }, items: [{ id, userName, stars, comment, createdAt, updatedAt }], page, limit, total }`, newest first |
| `GET` | `/:id/ratings/mine` | signed in | | `{ rating: {...} \| null }` |
| `PUT` | `/:id/ratings/mine` | signed in | `{ stars, comment? }` | 201 created / 200 updated: `{ rating, summary: { averageRating, ratingCount } }` |
| `DELETE` | `/:id/ratings/mine` | signed in | | 204; 404 `rating_not_found` when there is none |

Errors: 400 `validation_error` (R3, message "Vui lòng chọn số sao" when `stars` is missing), 401 without a
token, 403 `own_tour` (R5), 404 `tour_not_found` (R4).

Display name (R8): Auth adds the claim `name` (the account `fullName`) to new access tokens (additive;
`verifyJwt` and other services ignore unknown claims). Tokens issued before the change have no `name`:
the rating then shows "Người dùng GeoSound" until the next sign-in or refresh.

## 5. Events

None. Ratings are not sent to the chatbot index (the `tour.published` payload has no rating fields).

## 6. Client (next PR)

Rating form on tour detail and on the player end screen (#105), edit and delete of my rating (#162),
missing-star validation (#163), comment list with paging on tour detail.

## 7. Out of scope

Photos, AI check of comments, rating replies, helpful votes, sorting comments by stars.
