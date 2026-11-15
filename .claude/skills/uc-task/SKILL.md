---
name: uc-task
description: Build one later GeoSound use case (docs/use case/lam-sau, label uc-later, issues #267 to #275) end to end - design note approved by the user, backend in Tour / Auth / Notification, client screens, schema tested on a disposable Postgres, Node + Playwright tests, live check, PR, merge. Use when the user says "/uc-task <N>", "làm UC05", "làm UC tiếp theo", or asks to continue AI_PLAN section 6.
---

# uc-task: one later use case from design to merged PR

Argument: the issue number (`267`) or the UC code (`UC05`). No argument: the next row of `AI_PLAN.md`
section 6 whose dependencies are merged. Reply to the user in Vietnamese, short. Code, comments,
commits, issues and `docs/` in English; UI text in Vietnamese.

One UC = one issue = one branch = one PR (several commits). Do not start a second UC in the same run
unless the user asks.

## 0. Gate (stop and ask when one fails)

1. `gh issue view <N> --json state,title,body`: skip if CLOSED.
2. `AI_PLAN.md` section 6: dependencies merged (UC17 needs UC05, UC20 needs UC06, UC22 needs UC20 + UC21).
3. Open questions of this UC in `AI_PLAN.md` section 6.3 answered by the user. Unanswered: ask them
   with `AskUserQuestion` (one call, at most 4 questions, recommended option first), record the
   answers as decisions in section 6.2, then continue.
4. Push / PR / merge only when the user allowed it in this run; otherwise stop after the commits and
   show `git --no-pager log --oneline origin/develop..HEAD`.

## 1. Read (only what the UC touches)

- The UC doc `docs/use case/lam-sau/UC<NN>-*.md` and the issue body.
- The linked `[Frontend A]` issues (`gh issue view <n> --json body`): they list the screen states.
- `AI_PLAN.md` section 6 (row, decisions, open questions).
- The code you will change, starting from these entry points:

| Service | Entry points |
| --- | --- |
| Tour | `services/tour/src/{container.js,index.js}`, `domain/entities/tour.js` (`TOUR_STATUS`), `application/use-cases/`, `interfaces/http/{routes,controllers}/`, `infrastructure/persistence/`, `prisma/schema.prisma`; UC19 admin code is the model for admin routes (`review-tour.js`, `/admin/reviews`) |
| Auth | `services/auth/src/{container.js,index.js,config.js}`, `application/use-cases/`, `interfaces/http/routes/auth-routes.js`, `prisma/schema.prisma`; `RevokeAllSessions` for UC21; `/admin/sessions` (#265) is the model for an admin route |
| Notification | `services/notification/src/{index.js,notify.js}`, `prisma/schema.prisma` (model `Notification`, unused so far); the service is a worker without HTTP today |
| Shared | `shared/events/index.js` (zod, additive keys only), `shared/middleware` `verifyJwt(roles)` |
| Gateway | `gateway/src/index.js` (`mount('/api/<x>', TARGETS.<svc>)`) |
| Client | `client/src/App.jsx` (routes), `features/<area>/`, `lib/<area>.js` (calls through `lib/api.js`), guards `auth/RequireAuth.jsx`, `RequireContributor.jsx`, `useAuth().isAdmin`, styles in `styles/*.css`, tests in `client/test/ui/*.spec.js` with `fixtures.js` |

## 2. Design note, then wait

Write `docs/02-design/uc<NN>-<topic>.md` (link it from `docs/02-design/README.md`), at most about
120 lines:

1. Goal and actors (one paragraph).
2. Rules R1..Rn taken from the UC doc plus the answered questions.
3. Data: tables and columns (Prisma), indexes, unique keys, what is never stored.
4. API: method, path (through the gateway), role, request, response, errors (status + `code`).
5. Events: new or changed `shared/events` entries (additive only) and who consumes them.
6. Client: routes, screens and states (map each `[Frontend A]` issue to a state).
7. Out of scope.

Show the user a short Vietnamese summary of the note and wait for "ok" before writing code, unless
the user already said to build it without review.

## 3. Branch

```bash
git switch develop && git pull --ff-only
gh issue develop <N> --base develop --name feature/uc<NN>-<topic> --checkout
```

## 4. Backend

- Layers as in the existing code: `domain` (pure) -> `application/use-cases` (ports injected) ->
  `infrastructure` (Prisma, Redis, HTTP) -> `interfaces/http`; only `container.js` wires them.
- CI rule: only `src/index.js` imports `../shared/...`; pass `verifyJwt`, `publish`, `validateEvent`
  into `buildContainer`.
- Every route: zod validation at the edge, role check with `verifyJwt([...roles])`, errors with
  `status` + `code` + Vietnamese `error` message, ownership checks (a user only touches their data).
- State changes that can race (status moves, counters): conditional `updateMany` / transactions,
  409 when the state moved, never read-then-write without a condition.
- Admin actions append to the action log decided in section 6.2 (UC22) in the same transaction.
- New env keys go to the root `.env.example` with a comment; never touch `.env`.

## 5. Schema (Supabase is shared: never push it yourself)

1. Edit `prisma/schema.prisma`: additive only (new tables, nullable or defaulted columns). Add the matching
   migration folder (`docs/04-guides/supabase-access.md` section 4.3) and commit both together.
2. Validate: `MSYS_NO_PATHCONV=1 docker run --rm --network none -e DATABASE_URL="postgresql://ci:ci@localhost:5432/ci?schema=<schema>" -v "<root>/services/<svc>/prisma:/p:ro" -w /app cnpm-main-<svc> npx prisma validate --schema /p/schema.prisma`
3. Test the real queries on a throwaway Postgres, then delete it:

```bash
docker network create uccheck
docker run -d --rm --name uccheck-db --network uccheck -e POSTGRES_PASSWORD=pw postgis/postgis:16-3.4   # postgres:16-alpine is enough for auth/notification
MSYS_NO_PATHCONV=1 docker run --rm --network uccheck \
  -e DATABASE_URL='postgresql://postgres:pw@uccheck-db:5432/postgres?schema=<schema>' \
  -v "<root>/services/<svc>/src:/app/src:ro" -v "<root>/services/<svc>/prisma:/app/prisma:ro" -v "<scratch>/check.mjs:/app/check.mjs:ro" \
  -w /app --user root --entrypoint sh cnpm-main-<svc> -c "npx prisma migrate deploy && npx prisma generate >/dev/null && node check.mjs"
docker rm -f uccheck-db; docker network rm uccheck
```

   `check.mjs` (in the scratchpad, never committed) seeds rows and calls the repository methods.
4. Give the user the migrate command for the merge, never run it:
   `docker compose --profile migrate run --rm migrate deploy <svc>` (no service changes its schema on start;
   never `prisma db push` on Supabase).

## 6. Client

- One page per screen in `client/src/features/<area>/`, API helpers in `client/src/lib/<area>.js`
  (always through `api.js`: it refreshes tokens and rewrites local media URLs), route in `App.jsx`
  with the right guard, link from the existing menu (account, Studio, tour detail).
- Reuse classes from `styles/shell.css` / `tours.css` (`card`, `btn`, `chip`, `alert`, `menu__item`);
  every list has loading, empty, error-with-retry states; every destructive action uses `ConfirmDialog`.
- Phone first: no horizontal scroll at 390 px; tables scroll inside a wrapper.

## 7. Tests

```bash
# Node service, image layout and repo (CI) layout: both must pass
MSYS_NO_PATHCONV=1 docker run --rm -v "<root>/services/<svc>/src:/app/src:ro" -v "<root>/services/<svc>/test:/app/test:ro" -w /app --entrypoint sh cnpm-main-<svc> -c "node --test test/"
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "<root>:/repo:ro" --entrypoint sh cnpm-main-<svc> -c \
  "mkdir -p /tmp/r && cp -r /repo/shared /repo/services /tmp/r/ && ln -s /app/node_modules /tmp/r/node_modules && cd /tmp/r/services/<svc> && node --test"
# Client: Playwright on a copy of client/ (UI tests mock the API with page.route), plus a build
MSYS_NO_PATHCONV=1 docker run --rm -v "<root>/client:/src:ro" -w /work mcr.microsoft.com/playwright:v1.64.1-noble sh -c \
  "tar -C /src --exclude=node_modules -cf - . | tar -xf - ; npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1; npx playwright test <specs or nothing for all>; npx vite build >/dev/null && echo build ok"
```

- Use-case tests with in-memory fakes, HTTP tests with a stand-in for `verifyJwt(roles)` (see
  `services/auth/test/online-devices.test.js`), Playwright specs with mocked routes (see
  `client/test/ui/admin-devices.spec.js`).
- A UI test that fails on your branch: compare with `git archive develop client` to see whether `develop`
  fails too (the old `player-controls` seek failure was a player bug, fixed in #300).

## 8. Live check (real stack, no test data in other people's schemas)

- Rebuild only the changed service (`docker compose up -d --build --no-deps <svc>`; Auth: see 5.4).
- Call the routes through the gateway `http://localhost:8080`. For role checks, sign a short JWT
  inside the service container with `JWT_ACCESS_SECRET` and print only status codes and counts.
- Client changes are live at once (source mounted); the phone demo uses the ngrok URL.

## 9. Docs, commits, PR, merge

- Update the design note with what changed, `.env.example`, and the UC row in `AI_PLAN.md` section 6.
- Commits (`git add` explicit paths only): schema -> domain/use cases -> routes/wiring -> backend tests
  -> client -> client tests -> docs. Message `<type>: <short description>` + attribution trailer.
- PR, CI wait, merge and close check: exactly `.claude/skills/ai-task/SKILL.md` steps 6 and 7
  (`gh pr create --base develop --fill --body "Closes #<N> ..."`, merge commit, no squash, no `--admin`).

## 10. Report

Table: UC | issue | branch | commits | tests (backend / UI) | PR | status. Then the user actions:
schema migrate command (5.4), env keys, anything to test on the phone, and the next UC from section 6.
