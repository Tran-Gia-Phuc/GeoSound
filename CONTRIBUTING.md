# Contributing

How the team works on Git. Each step (init, requirements, design, implementation, testing) should have its own branch so reviews stay small and merges into `develop` stay clean.

## Branch model

```text
main
  └── staging
        └── develop
              └── feature/<short-name>
              └── docs/<doc-name>
              └── fix/<bug-name>
```

- Branch features and docs **from `develop`**.
- Do not commit directly to `main`, `staging`, or `develop` unless the team agrees.
- One branch, one purpose. Do not mix unrelated docs and code.

## Branch names

| Prefix | Use when | Example |
| --- | --- | --- |
| `feature/` | A scoped feature or init task | `feature/init-setup-project` |
| `docs/` | Documentation only | `docs/srs-login` |
| `fix/` | A bug fix | `fix/auth-token-expired` |
| `chore/` | Housekeeping (gitignore, format) | `chore/add-editorconfig` |

Use lowercase, hyphens, and a short name that describes the work.

### Name branches by feature, not by use case

- A branch name describes the **feature / capability**, not the UC number.
  Use `feature/tour-management`, not `feature/uc09-...`.
- **One UC can map to several feature branches.** Split a UC whenever its parts
  are genuinely separable (each is an independent deliverable and they do not
  churn the same files). Keep them in one branch only when they share the same
  module/aggregate and splitting would cause constant conflicts.
- Record the UC→feature mapping in the **PR description** (e.g. "Implements UC09"),
  not in the branch name.

| UC | Feature branch(es) |
| --- | --- |
| UC09 – Manage my tours (CRUD) | `feature/tour-management` (one branch: create/list/edit/delete share the Tour aggregate) |
| UC02 – Find & view tour | `feature/tour-search` + `feature/tour-detail` |
| UC04 – Listen to tour | `feature/tour-gps-playback` + `feature/tour-remote-preview` |
| UC03 – Offline tours | `feature/tour-download` + `feature/offline-library` |

## Commits

- One commit, one change. Write messages in **English**. Keep the style consistent on a branch.
- Suggested form: `<type>: <short description>`

| Type | Meaning |
| --- | --- |
| `feat` | New behavior |
| `docs` | Documentation |
| `fix` | Bug fix |
| `chore` | Config or cleanup |
| `test` | Add or update tests |
| `refactor` | Change structure, not behavior |

Example: `docs: add directory layout and init conventions`.

## Suggested workflow

1. `git checkout develop && git pull`
2. `git checkout -b feature/<short-name>`
3. Work in small, clear commits
4. Push: `git push -u origin HEAD`
5. Open a pull request **into `develop`**
6. Merge after review; delete the feature branch

## Documentation

- Write docs in **English**.
- Add or edit files under `docs/` in the matching phase folder (`00` → `04`).
- Each phase folder has a `README.md` index.
- Do not delete old docs when updating: note the version or date at the top if the content changes substantially.

## Do not commit

Secrets (`.env`, keys), `node_modules/`, build output, IDE junk. See `.gitignore`.
