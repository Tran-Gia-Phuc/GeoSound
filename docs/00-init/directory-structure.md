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
│   └── services/
│       └── <name>/              # one deployable monolith per service
│           ├── src/
│           └── tests/
│               ├── unit/
│               └── integration/
└── tests/
    ├── contract/                # cross-service contracts only
    └── e2e/                     # journeys across more than one service
```

`<name>` is a placeholder. Add real service folders when bounded contexts are named in design.

## Repository root

| Path | Role |
| --- | --- |
| `README.md` | Entry point: what the project is, tree, doc links |
| `CONTRIBUTING.md` | How to branch, commit, and open a PR |
| `.gitignore` | Files that must not be pushed |

## `docs/`

One folder per phase, numbered so the reading order stays clear. Each folder's `README.md` is that phase's index.

Do not put source code in `docs/`. Do not scatter design or specification files at the repo root.

## `frontend/`

Client application. Unit and component tests live next to the UI once the stack is chosen.

## `backend/` — microservices, monolith per service

The backend is **several services**, not one process. Each service is still a **monolith**: one codebase, one process, one database, internal modules. It is not split into smaller deployables.

| Path | Role |
| --- | --- |
| `backend/services/<name>/src` | That service's API, domain, and adapters |
| `backend/services/<name>/tests/unit` | Fast tests with no I/O |
| `backend/services/<name>/tests/integration` | That service + **its** database; other services mocked |

Do not share a database across services. Shared libraries (if any) belong under `backend/shared/` and stay free of business rules that belong to one service.

When scaffolding a service, keep install/run/env notes in that service and link them from the root README.

## `tests/` — cross-service only

| Path | Role |
| --- | --- |
| `tests/contract` | Provider/consumer or schema checks between services |
| `tests/e2e` | Full flows (often through the frontend or an API gateway) |

Unit and single-service integration tests do **not** go here. See [docs/03-testing/strategy.md](../03-testing/strategy.md).

If the team later picks a different monorepo layout, update this file and the README so only one layout exists.
