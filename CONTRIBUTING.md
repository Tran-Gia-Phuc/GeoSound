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
