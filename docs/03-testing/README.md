# 03 — Testing

Automated tests follow **microservices + monolith per service**. Strategy and folder rules: [strategy.md](strategy.md).

| File | Content |
| --- | --- |
| [strategy.md](strategy.md) | Layers, locations, what not to do |

Expected later (not written in init):

- Test plan and cases for the main flows
- Result / bug notes

| Code location | Kind of test |
| --- | --- |
| `backend/services/<name>/tests/unit` | Fast tests inside one service |
| `backend/services/<name>/tests/integration` | That service + its own DB |
| `tests/contract` | Agreements between services |
| `tests/e2e` | Cross-service / UI journeys |
| `frontend/` (next to UI) | Component / unit tests for the client |
