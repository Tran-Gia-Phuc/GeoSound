# GeoSound

Course project for **Software Engineering 2** — Saigon University.

This repository holds the team's source code, documentation, and working conventions. Current step: **infrastructure + service skeletons scaffolded** (per [docs/tech-stack.md](docs/tech-stack.md)).

## Directory layout

```text
GeoSound/
├── docker-compose.yml             # gateway + 5 service + rabbitmq + redis + postgres(dev)
├── docker-compose.dev.yml         # override dev (hot reload, volume)
├── .env.example                   # mẫu biến môi trường
├── gateway/                       # API Gateway (Express) — route, rate-limit
├── services/
│   ├── auth/                      # UC01, UC21
│   ├── tour/                      # UC02,03,07-11,13,17,18 (PostGIS)
│   ├── moderation/                # UC15,19,06,20,22 (Gemini, state machine)
│   ├── media/                     # worker TTS/translate -> S3
│   └── notification/              # UC16 (worker)
├── shared/                        # events (zod) + middleware + helper rabbitmq
├── client/                        # React PWA (Tourist + Contributor + Admin)
├── infra/postgres/init/           # bật PostGIS + tạo schema mỗi service
├── docs/                          # tài liệu dự án theo phase
└── tests/{contract,e2e}           # test xuyên service
```

Folder-by-folder notes: [docs/00-init/directory-structure.md](docs/00-init/directory-structure.md).
Architecture & công nghệ: [docs/tech-stack.md](docs/tech-stack.md).

## Chạy thử (dev)

```bash
cp .env.example .env         # rồi điền secret khi cần
docker compose up -d         # dựng hạ tầng + service
# Kiểm tra: http://localhost:8080/health  (gateway)
#           http://localhost:15672          (RabbitMQ UI, guest/guest)
```

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

This initialization work lives on `feature/init-setup-project` (branched from `develop`). Branch names, commits, and pull requests: [CONTRIBUTING.md](CONTRIBUTING.md).

## Backend shape

Microservices, **monolith per service**: each service is independently deployable and keeps its own database and internal modules. How tests are split: [docs/03-testing/strategy.md](docs/03-testing/strategy.md).

## Tech stack

React (Vite) PWA · Node.js + Express (microservice) · Prisma · PostgreSQL + PostGIS (Supabase host) · Redis · RabbitMQ · AWS S3 · Gemini · Google Cloud TTS/Translate · Docker Compose. Chi tiết & lý do chọn: [docs/tech-stack.md](docs/tech-stack.md).

## Repository

- Remote: [Tran-Gia-Phuc/GeoSound](https://github.com/Tran-Gia-Phuc/GeoSound)
