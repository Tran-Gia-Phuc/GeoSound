---
name: ai-task
description: Run one or more GeoSound AI / Moderation GitHub issues end to end (branch from the issue, dev sub-agent, test-runner, contract-reviewer, small commits, PR "Closes #N", CI, merge, close check). Use when the user says "/ai-task <N> [N...]", "làm task #N", "chạy task tiếp", or asks to continue the AI_PLAN task list.
---

# ai-task: one issue from branch to merged PR

Arguments: issue numbers (e.g. `173` or `184 185`). No argument: take the next open task from `AI_PLAN.md` section 4.
Read `CLAUDE.md` and `AI_PLAN.md` (sections 4 and 5) first. Reply to the user in Vietnamese, short.

## 0. Gate

- `gh issue view <N> --json state,title,body`. Skip if CLOSED or a merged PR exists (`gh pr list --search "head:<branch>" --state all`).
- Dependencies in `AI_PLAN.md` section 4 must be merged.
- **#180 (Tour integration) and any file outside our services**: open the PR, never merge.
- Push / PR / merge only when the user allowed it in this run; otherwise stop after commits and show `git --no-pager log --oneline origin/develop..HEAD`.

## 1. Branch (worktree when tasks run in parallel)

```bash
git switch develop && git pull --ff-only
gh issue develop <N> --base develop --name <branch>          # creates the remote branch, linked to the issue
git fetch -q
git switch <branch>                                          # single task
git worktree add /e/CNPM/git/wt-<N> <branch>                 # parallel task: the agent edits only inside wt-<N>
```

A task split over several PRs: only the last PR may close the issue. Create the other branches with `git switch -c <branch> develop` (not `gh issue develop`, whose link closes the issue on merge) and write "Part of #<N>" in the PR body.

Branch names: see `AI_PLAN.md` section 4 (`feature/…`, `docs/…`, `test/…`, `chore/…`).

## 2. Implement with a sub-agent

| Files | Agent (fallback: `general-purpose` + rules pasted from `.claude/agents/<name>.md`) |
| --- | --- |
| `services/ai` | `ai-python-dev` |
| `services/moderation`, `shared/` | `moderation-node-dev` |
| `services/tour` (only #180) | `general-purpose`, "small reviewable diff, another teammate owns Tour" |
| `docs/` only | `docs-writer` |

Keep prompts tight (token budget): list the exact files and doc sections to read (never a whole design doc). The prompt always contains: working directory / worktree, issue number and code, files to read first, the acceptance criteria, "no git write commands, never read .env, no real LLM, no network in tests", the CI rule for Node ("only `src/index.js` imports `../shared`"), the exact test commands below, and "report files changed, counts, conflicts with docs".

## 3. Test (test-runner)

Node services: **both layouts must pass with 0 fail** (CI runs the repo layout).

```bash
# image layout
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "<root>/shared:/app/shared:ro" \
  -v "<root>/services/<svc>/src:/app/src:ro" -v "<root>/services/<svc>/test:/app/test:ro" -w /app cnpm-main-<svc> node --test
# repo (CI) layout
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "<root>:/repo:ro" --entrypoint sh cnpm-main-<svc> -c \
  "mkdir -p /tmp/r && cp -r /repo/shared /repo/services /tmp/r/ && ln -s /app/node_modules /tmp/r/node_modules && cd /tmp/r/services/<svc> && node --test"
# prisma (if schema.prisma changed)
MSYS_NO_PATHCONV=1 docker run --rm --network none -e DATABASE_URL="postgresql://ci:ci@localhost:5432/ci?schema=<svc>" \
  -v "<root>/services/<svc>/prisma:/p:ro" -w /app cnpm-main-auth npx prisma validate --schema /p/schema.prisma
```

AI service:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "<root>/services/ai:/src:ro" -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint sh cnpm-main-ai:latest -c "pip install -q pytest; python -m pytest tests -q -p no:cacheprovider -rs"
```

`<root>` is `E:/CNPM/git/CNPM-main` or the worktree `E:/CNPM/git/wt-<N>`. Run each suite once (twice only for timing-sensitive tests). Fail: send the failure back to the same dev agent (SendMessage), at most 2 rounds, then mark the task blocked. An agent stopped by a usage limit is resumed with SendMessage, never restarted.

## 4. Review (contract-reviewer)

Ask for PASS/FAIL per item: issue AC, contract (`CLAUDE.md` section 4, shared zod schemas, Moderation ↔ AI mapping), business rules (`CLAUDE.md` section 3, D-decisions), CI rule, security (tokens, SSRF, logs), scope (only intended paths), English, no secrets. Fix every FAIL through the dev agent and review again. Small doc / comment fixes can be done directly. Accept advisories that are cheap and safe.

New env keys must be added to root `.env.example` (and `services/ai/.env.example` for AI) with no duplicate keys:
`grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort | uniq -d` prints nothing.

## 5. Commit

- One change per commit, `<type>: <short description>` (`feat, fix, refactor, test, docs, chore`), English, ending with the attribution trailer from the system prompt.
- `git add` explicit paths only; never `.`, `-A`, `CNPM-main/`, `PROJECT_TREE*.md`, root `package-lock.json`, `.env`, `.claude/settings.local.json`.
- Typical order: schema/config → domain → use-case → interface/wiring → tests → docs.

## 6. PR, CI, merge

```bash
git push -u origin <branch>
gh pr create --base develop --head <branch> --fill --body "Closes #<N>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
# wait in the background, never with chained sleeps
until [ "$(gh pr checks <PR> | grep -c -E 'pass|fail')" -ge 3 ] && [ "$(gh pr checks <PR> | grep -c -E 'pending|queued|in_progress')" = 0 ]; do sleep 20; done
```

- Merge only if `gh pr checks <PR> | grep -q fail` finds nothing: `gh pr merge <PR> --merge` (no squash, no `--admin`).
- A failing `Client — browser smoke tests` on a PR that does not touch `client/`: check the log (`gh run view <run> --log-failed`); if it is the known flaky `player-controls.spec.js`, `gh run rerun <run> --failed`, wait, then merge when green. Anything else: stop and report.
- Merge blocked (conflict, required review): stop, report "chờ người merge".

## 7. After merge

```bash
gh issue view <N> --json state      # OPEN → gh issue close <N> --comment "Done in PR #<PR>"
git switch develop && git pull --ff-only
git worktree remove /e/CNPM/git/wt-<N>    # if used
```

Run the service tests on `develop` (step 3). If `develop` is broken: branch `fix/revert-<N>`, `git revert -m 1 <merge sha>`, PR, merge.

## 8. Report

Table: task | branch | commits | tests | reviewer | PR | issue | status. Then the remaining tasks and any owner action (env keys, `prisma db push`, PRs waiting for another teammate).
