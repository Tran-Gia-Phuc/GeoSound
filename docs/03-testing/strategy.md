# Test strategy — microservices, monolith per service

> Architecture choice for init: the backend is several independently deployable **services**. Each service is a **monolith** (one process, one database, internal modules). Tests follow that split.

## Why tests are split

A service is tested like a single app. The system is tested where services talk to each other.

```text
                    few, slow
                 ┌─────────────┐
                 │  E2E / UI   │   tests/e2e
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │  Contract   │   tests/contract
                 └──────┬──────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
 ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
 │ integration │ │ integration │ │ integration │   backend/services/<name>/tests/integration
 └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
        │               │               │
 ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
 │    unit     │ │    unit     │ │    unit     │   backend/services/<name>/tests/unit
 └─────────────┘ └─────────────┘ └─────────────┘
                    many, fast
```

| Layer | What it proves | Where it lives | Dependencies |
| --- | --- | --- | --- |
| Unit | One module / function in a service | `backend/services/<name>/tests/unit` | None (mocks only) |
| Service integration | That service + **its** DB / bus / HTTP API | `backend/services/<name>/tests/integration` | That service's stack only |
| Contract | Two services agree on request/response | `tests/contract` | Schemas or a contract tool; other services mocked |
| E2E | A user flow across frontend + several services | `tests/e2e` | Running system (compose / local cluster) |

Frontend unit / component tests stay in `frontend/` (next to the UI). They are not listed above because they do not change with the backend style.

## Rules

1. **Default to the service.** If a test only needs one service, put it under that service. Do not put it in root `tests/`.
2. **Root `tests/` is cross-service only.** Contract checks and full-system flows. No unit tests here.
3. **Do not start every service for a unit or service-integration test.** Mock outbound HTTP / events. Bring up only that service's database.
4. **One database per service in integration tests.** A service must not read another service's tables in tests (same rule as production).
5. **Contracts before wide E2E.** If service A calls service B, lock the payload in `tests/contract` so B can change internals without breaking A silently.
6. **Keep E2E few.** Cover the main user journeys only. They are slow and brittle.

## What each service test folder looks like

```text
backend/services/<name>/
├── src/
└── tests/
    ├── unit/           # domain, use cases, pure logic
    └── integration/    # API + this service's DB, mocks for other services
```

Treat `<name>` as one deployable monolith: test its modules together, not as if they were separate microservices.

## What root `tests/` looks like

```text
tests/
├── contract/     # consumer/provider or OpenAPI/async schema checks
└── e2e/          # journeys that cross gateway + more than one service
```

Add a `tests/README.md` with how to run compose / the local stack when scaffolding exists.

## What we do not do

- A single giant `tests/` tree that mixes unit tests from every service.
- E2E as the only safety net (too slow to guide daily work).
- Shared test database for all services (hides coupling).

## Docs vs code

This file is the strategy. Manual test cases and reports will be added later under `docs/03-testing/`. Automated tests live in the folders above, not in `docs/`.
