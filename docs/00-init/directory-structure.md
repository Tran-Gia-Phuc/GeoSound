# Directory structure

```text
GeoSound/
├── .gitignore
├── README.md
├── CONTRIBUTING.md
├── docs/
│   ├── README.md
│   ├── 00-init/
│   ├── 01-requirements/
│   ├── 02-design/
│   ├── 03-testing/
│   └── 04-guides/
├── frontend/
├── backend/
└── tests/
```

## Repository root

| Path | Role |
| --- | --- |
| `README.md` | Entry point: what the project is, tree, doc links |
| `CONTRIBUTING.md` | How to branch, commit, and open a PR |
| `.gitignore` | Files that must not be pushed |

## `docs/`

One folder per phase, numbered so the reading order stays clear. Each folder's `README.md` is that phase's index.

Do not put source code in `docs/`. Do not scatter design or specification files at the repo root.

## `frontend/` and `backend/`

Homes for the client and server once the stack is chosen. They are empty on purpose (`.gitkeep` keeps the folders in Git).

When scaffolding:

- All client dependencies and config live in `frontend/`.
- All APIs, business logic, and server-side data live in `backend/`.
- Update the root README with install, run, and environment-variable commands.

If the team later picks a different monorepo layout (for example `apps/web`, `apps/api`), update this file and the README so only one layout exists.

## `tests/`

Shared or integration tests. Unit tests may live next to the code (`frontend/…`, `backend/…`) depending on the tooling; note that choice in `docs/03-testing/`.
