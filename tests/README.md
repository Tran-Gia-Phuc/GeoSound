# Cross-service tests

Only tests that involve **more than one service** (or the UI plus the backend) belong here.

| Folder | Use |
| --- | --- |
| `contract/` | Consumer/provider or schema checks between services |
| `e2e/` | User journeys across the running system |

Unit and single-service integration tests live under `backend/services/<name>/tests/`. Full rules: [docs/03-testing/strategy.md](../docs/03-testing/strategy.md).
