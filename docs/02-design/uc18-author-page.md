# UC18: public author page and follow (design)

Issue #272 (label `uc-later`). Use case: `docs/use case/lam-sau/UC18-trang-tac-gia.md`.
Step 1 (this note): backend in Auth (profile fields, follows) and one additive filter in the Tour
public search. The client screens (author page, profile editor, "following" list) come in a later PR.

## 1. Goal

Every contributor has a public author page with an avatar, a short introduction and their public
tours. Anyone can open it; a signed-in user can follow or unfollow the author and see the authors
they follow. Any signed-in user can edit their own name, introduction and avatar (A1).

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | Reading the author page and its tours is anonymous; follow, unfollow, the follow list and profile edits need sign-in (AI_PLAN L3) |
| R2 | Only an active contributor has an author page: unknown ids, tourists, admins, banned accounts and accounts under a running suspension answer 404 `author_not_found`. A suspension whose end passed counts as active (UC21 R5) |
| R3 | Only an author with a page (R2) can be followed |
| R4 | A user cannot follow themselves: 400 `self_follow`. Their own follow state reads `following: false` |
| R5 | Follow and unfollow are idempotent. The unique pair (follower, author) decides; concurrent follows of the same pair leave one row. Unfollow is always allowed, so a follow of an author who later lost the page can still be removed |
| R6 | Avatar: uploaded by the client through the existing Media upload; Auth only stores the URL. Accepted: any `https://` URL, the Media form `http(s)://<host>/api/media/files/images/...`, or the path `/api/media/files/images/...`. Refused: `javascript:`, `data:`, other `http` paths, protocol-relative `//host`, user info, whitespace, backslashes, `..` segments, more than 500 characters |
| R7 | Bio: trimmed, at most 500 characters; full name trimmed, 1..120. `null` or blank clears bio and avatar; the full name cannot be cleared |
| R8 | The author page never shows the email, role, status or sign-in data. Only `PATCH /me/profile` (the owner) returns the email |
| R9 | Only public tours are listed on the page (UC18 business rule); an author without public tours shows an empty list (E1) |
| R10 | No notification to followers when an author publishes (AI_PLAN L12) |

## 3. Data (schema `auth`, additive)

```prisma
model User {
  // ...existing columns
  bio       String?                        // R7
  avatarUrl String?  @map("avatar_url")    // R6
}

model AuthorFollow {
  id         String   @id @default(uuid())
  followerId String   @map("follower_id")
  authorId   String   @map("author_id")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  // relations to User, onDelete: Cascade (a deleted account takes its follows with it)
  @@unique([followerId, authorId])
  @@index([authorId])
  @@map("author_follows")
}
```

Follow is `INSERT ... ON CONFLICT DO NOTHING` (`createMany` with `skipDuplicates`), unfollow is
`deleteMany`: no read-then-write. The follower count is counted on read (`count` by `author_id`,
indexed); no counter column to keep in sync. Profile edits go through `updateProfile`, which writes
only the given profile columns (never the password, role or UC21 status).

## 4. API (gateway `/api/auth`)

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/authors/:id` | public | | author |
| `GET` | `/authors/:id/follow` | signed in | | `{ following, followerCount }` |
| `PUT` | `/authors/:id/follow` | signed in | | `{ following: true, followerCount }` |
| `DELETE` | `/authors/:id/follow` | signed in | | `{ following: false, followerCount }` |
| `GET` | `/me/following` | signed in | `page` (1..), `limit` (1..50, default 20) | `{ items, total, page, limit }`, newest follow first |
| `PATCH` | `/me/profile` | signed in, any role | `{ fullName?, bio?, avatarUrl? }`, at least one | author + `email`, `role` |

Author: `{ id, fullName, avatarUrl, bio, followerCount, joinedAt }`; follow list items add
`followedAt`. Authors who lost their page (R2) are left out of the follow list and its total.

Errors: 400 `validation_error` (body or query; Vietnamese message per field), 400 `self_follow`,
401 from the guard, 404 `author_not_found` "Không tìm thấy tác giả", 404 `user_not_found` (profile
edit of an account that no longer exists).

The access token `name` claim (UC05) follows the new full name at the next refresh; nothing else changes.

## 5. Tour: public tours of one author

`GET /api/tours` (UC02 public search) accepts an optional `authorId` (trimmed, 1..100). It is one more
condition in `publicWhere`, so it combines with every other filter and sort and still returns only
`public` tours. The author page calls `GET /api/tours?authorId=<id>&sort=recent`.

## 6. Events

None. Follows and profile data stay inside Auth (R10).

## 7. Client (later PR)

- `/authors/:id`: avatar, name, bio, follower count, follow button (sign-in prompt when anonymous),
  public tours (empty state for E1). Linked from the tour detail author line.
- Account menu: "Hồ sơ tác giả" (edit name, bio, avatar via Media upload) and "Đang theo dõi".
- Avatar URLs go through `localizeUrl` like other Media URLs.

## 8. Checks

Auth use cases and routes with in-memory fakes (`test/uc18-author-page.test.js`), the Tour search test
for `authorId`. On a disposable Postgres: `prisma db push`, five concurrent follows of one pair leave one
row, follower counts, follow list order and paging, banned and tourist targets 404, self follow 400,
profile update and clear, cascade on account delete.

## 9. Out of scope

Follower notifications (L12), a list of an author's followers, private / hidden author pages,
avatar cropping, author statistics (UC17).
