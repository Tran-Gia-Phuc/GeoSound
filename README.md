# GeoSound

Course project for **Software Engineering 2** — Saigon University.

This repository holds the team's source code, documentation, and working conventions. Current step: **project initialization** (directory layout + baseline docs).

## Directory layout

```text
GeoSound/
├── docs/                 # Project docs, one folder per phase
│   ├── 00-init/          # Vision, scope, conventions
│   ├── 01-requirements/  # Requirements spec (later)
│   ├── 02-design/        # System design (later)
│   ├── 03-testing/       # Test plan and cases (later)
│   └── 04-guides/        # Setup / usage guides (later)
├── frontend/             # Client application
├── backend/              # Server-side services
├── tests/                # Automated tests
├── CONTRIBUTING.md       # Branch, commit, and review rules
└── README.md
```

Folder-by-folder notes: [docs/00-init/directory-structure.md](docs/00-init/directory-structure.md).

## Documentation

| Phase | Purpose | Status |
| --- | --- | --- |
| [Init](docs/00-init/) | Vision, scope, working conventions | In progress |
| [Requirements](docs/01-requirements/) | Functional / non-functional spec | Not started |
| [Design](docs/02-design/) | Architecture, data model, UI | Not started |
| [Testing](docs/03-testing/) | Strategy and test cases | Not started |
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

## Tech stack

Not decided yet. Update this README and `docs/00-init/` once the team agrees on frontend, backend, and database.

## Repository

- Remote: [Tran-Gia-Phuc/GeoSound](https://github.com/Tran-Gia-Phuc/GeoSound)
