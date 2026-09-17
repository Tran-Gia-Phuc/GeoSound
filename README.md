# GeoSound

Course project for **Software Engineering 2** — Saigon University.

This repository holds the team's source code, documentation, and working conventions. Current step: **project initialization** (directory layout + baseline docs).

## Directory layout

```text
GeoSound/
├── docs/                          # Project docs, one folder per phase
│   ├── 00-init/
│   ├── 01-requirements/
│   ├── 02-design/
│   ├── 03-testing/
│   └── 04-guides/
├── frontend/                      # Client (unit/component tests live here)
├── backend/services/<name>/       # One monolith per microservice
│   ├── src/
│   └── tests/{unit,integration}
├── tests/contract                 # Cross-service contracts
├── tests/e2e                      # Multi-service / UI journeys
├── CONTRIBUTING.md
└── README.md
```

Folder-by-folder notes: [docs/00-init/directory-structure.md](docs/00-init/directory-structure.md).

## Documentation

| Phase | Purpose | Status |
| --- | --- | --- |
| [Init](docs/00-init/) | Vision, scope, working conventions | In progress |
| [Requirements](docs/01-requirements/) | Functional / non-functional spec | Not started |
| [Design](docs/02-design/) | Architecture, data model, UI | Not started |
| [Testing](docs/03-testing/) | Strategy (layers + folders); cases later | Strategy drafted |
| [Guides](docs/04-guides/) | Install, deploy, usage | Not started |

Full index: [docs/README.md](docs/README.md).

## Git branches

The repo keeps three long-lived branches:

| Branch | Role |
| --- | --- |
| `main` | Stable build, ready to submit or demo |
| `staging` | Integration before `main` |
| `develop` | Shared team development line |

This initialization work lives on `feature/init-project` (branched from `develop`). Branch names, commits, and pull requests: [CONTRIBUTING.md](CONTRIBUTING.md).

## Backend shape

Microservices, **monolith per service**: each service is independently deployable and keeps its own database and internal modules. How tests are split: [docs/03-testing/strategy.md](docs/03-testing/strategy.md).

## Tech stack

Not decided yet. Update this README and `docs/00-init/` once the team agrees on frontend, backend, and database.

## Repository

- Remote: [Tran-Gia-Phuc/GeoSound](https://github.com/Tran-Gia-Phuc/GeoSound)
