# Directory structure

> Layout được chốt theo [tech-stack.md §8](../tech-stack.md). Đây là layout **duy nhất** của repo.

```text
GeoSound/
├── docker-compose.yml            # gateway + 5 service + rabbitmq + redis + postgres(dev)
├── docker-compose.dev.yml        # override dev (hot reload, volume)
├── .env.example                  # mẫu biến môi trường (không commit .env thật)
├── package.json                  # npm workspaces (gateway, services/*, shared, client)
├── gateway/                      # API Gateway (Express): route, rate-limit (Redis)
│   ├── src/  ├── Dockerfile  └── package.json
├── services/
│   ├── auth/                     # UC01, UC21
│   │   ├── src/{routes,controllers,services,repositories,events}
│   │   ├── prisma/schema.prisma  # schema "auth"
│   │   ├── Dockerfile  └── package.json
│   ├── tour/                     # UC02,03,07-11,13,17,18 (PostGIS)
│   ├── moderation/               # UC15,19,06,20,22 (Gemini, state machine)
│   ├── media/                    # worker TTS/translate -> S3 (src/consumers)
│   └── notification/             # UC16 (worker, src/consumers)
├── shared/
│   ├── events/                   # tên event + payload schema (zod)
│   ├── middleware/               # verifyJwt, errorHandler, logger
│   └── rabbitmq/                 # helper connect/publish/consume
├── client/                       # React PWA (Tourist + Contributor + Admin)
├── infra/
│   └── postgres/init/            # bật PostGIS + tạo schema auth/tour/...
├── docs/                         # tài liệu, mỗi phase 1 folder
└── tests/
    ├── contract/                 # contract xuyên service
    └── e2e/                      # journey qua nhiều service / UI
```

## Nguyên tắc

| Vùng | Vai trò |
| --- | --- |
| `gateway/` | 1 cửa vào public, verify JWT + rate-limit (Redis), route tới service |
| `services/<name>/` | Một microservice độc lập: 1 codebase, 1 process, **1 schema DB riêng** |
| `shared/` | Code dùng chung **không chứa business rule riêng của 1 service** |
| `client/` | React PWA; unit/component test nằm cạnh UI |
| `infra/` | Script hạ tầng (init Postgres/PostGIS) |
| `tests/` | **Chỉ** contract & e2e xuyên service; unit/integration ở trong từng service |

## Service nội bộ

- HTTP service (`auth`, `tour`, `moderation`): `src/{routes,controllers,services,repositories,events}`.
- Worker (`media`, `notification`): `src/{consumers,services,events}` — tiêu thụ event RabbitMQ, không mở port.
- **Schema-per-service**: service không truy cập bảng của nhau, chỉ qua API (REST) hoặc event (RabbitMQ). Xem [tech-stack.md §5](../tech-stack.md).

## Build Docker

Mỗi service build với **context = repo root** (xem `docker-compose.yml`) để Dockerfile copy được `shared/`. Dev dùng `docker-compose.dev.yml` mount `src/` và `shared/` để hot reload.

Nếu team đổi layout sau này, cập nhật **file này + README + tech-stack.md** để chỉ tồn tại một layout.
