# GeoSound — Tech Stack & Architecture

> Tài liệu tham chiếu kiến trúc & công nghệ cho team dev GeoSound.
> Nguồn use case: [`use case/`](use%20case/). Cập nhật: 2026-10-18.

---

## 1. Hệ thống làm gì

**GeoSound** — app **audio guide du lịch theo GPS** (tham khảo izi.travel). Khách đi bộ ngoài thực địa, app tự động phát audio thuyết minh khi vào **vùng kích hoạt** của mỗi điểm dừng; chạy được **offline** sau khi tải tour.

**3 actor:** Tourist (khách) · Contributor (tác giả nội dung) · Admin (chỉ kiểm duyệt, không tạo nội dung).

**Nguyên tắc nội dung:** text mô tả mỗi điểm **bắt buộc**; audio người thật **tùy chọn**; không có → tự **dịch + TTS**. Khi phát: ưu tiên giọng người thật → TTS. TTS được **pre-render & cache** để chạy offline.

**Kiểm duyệt 3 tầng:** Tầng 1 AI tự động (Gemini text + NSFW.js ảnh + turf.js vùng cấm → Pass/Warning/Reject) → Tầng 2 Admin review → Tầng 3 Community report (≥5 report/7 ngày → "Chờ Admin xem lại").

**Phạm vi đợt này:** 13 UC làm trước — UC01, 02, 03, 04, 07, 08, 09, 10, 11, 12, 13, 15, 19. (9 UC còn lại làm sau.)

---

## 2. Mục tiêu & ràng buộc

- **Build nhanh** (đồ án CNPM2 – SGU), đồng thời **học kiến trúc microservice**.
- Đã cân nhắc đánh đổi: microservice tăng độ phức tạp vận hành so với "build nhanh" → chọn mức **vừa phải: 5 service + API Gateway** (không chẻ quá mịn).

---

## 3. Tech Stack

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| **Frontend** | React (Vite) + **PWA** | 1 codebase cho cả 3 actor |
| — Map | Leaflet (`react-leaflet`) + **Leaflet-Geoman** + **turf.js** | Vẽ pin/route/vùng tròn-đa giác; check GPS trong polygon |
| — Tiles | OpenStreetMap (free) | Nâng Mapbox/Google khi cần |
| — Geocoding | Nominatim (free) cho demo | Nâng Mapbox/Google khi cần chất lượng |
| — AI client | **NSFW.js** | Quét ảnh NSFW tại trình duyệt (UC09/UC10) |
| — Offline | Service Worker + Cache/IndexedDB | Cache tour + audio TTS |
| **Backend** | **Node.js + Express** (microservice) | Mỗi service 1 app độc lập |
| — ORM | **Prisma** | Mỗi service 1 schema riêng |
| — Auth | **JWT + bcrypt** (tự làm) | access + refresh token; 3 vai trò |
| — OTP | **Nodemailer** (email) | SMS để sau (tốn phí) |
| **Message Queue** | **RabbitMQ** (`rabbitmq:3-management`) | Event/job async |
| **Cache** | **Redis** (`redis:7-alpine`) | Cache, OTP TTL, rate-limit |
| **Database** | **PostgreSQL @ Supabase** + **PostGIS** | Supabase CHỈ làm Postgres host dùng chung cho team |
| **Storage** | **AWS S3** | Ảnh, audio người thật, audio TTS |
| **AI kiểm duyệt** | **Gemini API** (text, server-side) | Tầng 1 (UC15) |
| **TTS + Dịch** | **Google Cloud TTS + Translate** | Xuất .mp3 → cache offline |
| **Container** | **Docker + Docker Compose** | Dev local + đóng gói service |

---

## 4. Kiến trúc tổng thể

```
                   ┌─────────────┐
   React PWA  ───▶ │ API Gateway │  (routing, verify JWT, rate-limit via Redis)
                   └──────┬──────┘
         ┌────────────┬───┴────┬──────────────┬───────────────┐
         ▼            ▼        ▼              ▼               ▼
   ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐
   │   Auth   │ │   Tour   │ │ Moderation │ │ Media/TTS │ │ Notification │
   │ service  │ │ service  │ │  service   │ │  worker   │ │   service    │
   └──────────┘ └──────────┘ └────────────┘ └───────────┘ └──────────────┘
         └──────────── RabbitMQ (events/jobs) ─────────────┘
         └──────────── Redis (cache, OTP, rate-limit) ──────┘
         └──────────── PostgreSQL @ Supabase + PostGIS ─────┘   S3 (ảnh/audio)
```

### Phân rã service

| Service | UC phụ trách | Vai trò chính |
|---|---|---|
| **API Gateway** | — | 1 cửa vào, verify JWT, rate-limit (Redis), route tới service |
| **Auth** | UC01, UC21 | Đăng ký/đăng nhập/OTP/JWT/bcrypt, phân quyền, ban tài khoản |
| **Tour** | UC02, 03, 07–11, 13, 17, 18 | CRUD tour/điểm/route/vùng kích hoạt, tìm kiếm, đóng gói offline, trang tác giả. **Dùng PostGIS nhiều nhất** |
| **Moderation** | UC15, 19, 06, 20, 22 | Pipeline kiểm duyệt 3 tầng, gọi Gemini, hàng chờ Admin, **state machine trạng thái tour**, ghi log. Phát event |
| **Media/TTS** (worker) | UC12, phần TTS của UC03 | Consumer RabbitMQ: dịch + Google TTS → .mp3 → S3 |
| **Notification** | UC16 | Consumer event → báo contributor (in-app/email) |

---

## 5. Dữ liệu & DB (schema-per-service)

- **Một Postgres Supabase dùng chung** cho team; **mỗi service sở hữu một `schema` riêng**: `auth.*`, `tour.*`, `moderation.*`, `media.*`, `notification.*`.
- Service **không đụng bảng** của service khác — chỉ giao tiếp qua API hoặc event.
- **Không** dùng DB-per-instance (mâu thuẫn với Supabase dùng chung).
- **PostGIS** bật ngay từ migration đầu → query không gian ("GPS trong polygon vùng kích hoạt", "tour gần tôi") chạy trong DB.
- **Dev local:** chạy container `postgis/postgis` để code offline; trỏ Supabase (qua `.env`) khi dùng DB chung/staging.

---

## 6. Message Queue (RabbitMQ) — luồng event chính

| Event | Phát bởi | Tiêu thụ bởi | Ý nghĩa |
|---|---|---|---|
| `tour.submitted` | Tour | Moderation | Contributor gửi duyệt → chạy AI (Tầng 1) |
| `tour.ai_passed` / `tour.ai_rejected` | Moderation | Tour, Notification | Kết quả AI; rejected → trả về sửa |
| `tour.approved` | Moderation | Media, Notification | Admin duyệt → kích hoạt render TTS + báo contributor |
| `tts.render.requested` | Moderation/Tour | Media | Yêu cầu render tất cả ngôn ngữ |
| `tts.render.completed` | Media | Tour | Audio .mp3 đã lên S3, tour sẵn sàng tải nhanh |
| `tour.rejected` / `reported` / `hidden` | Moderation | Notification | Báo contributor kèm lý do (UC16) |

> **Thiết kế:** render TTS **lúc tour được duyệt** (không phải lúc tourist bấm tải) để tải offline nhanh. Việc nặng → chạy async qua worker, tránh timeout.

---

## 7. Cache (Redis) — công dụng

- **Cache đọc nóng**: danh sách / chi tiết tour công khai (Tourist đọc nhiều).
- **OTP**: lưu mã kèm **TTL 2 phút** (hợp hơn để trong DB).
- **Rate-limit** tại gateway.
- **Refresh-token / blacklist JWT** khi ban tài khoản.

---

## 8. Cấu trúc thư mục (monorepo)

```
GeoSound/
├─ docker-compose.yml            # gateway + 5 service + rabbitmq + redis + postgres(dev)
├─ docker-compose.dev.yml        # override dev (hot reload, volume)
├─ .env.example
├─ gateway/                      # API Gateway (Express)
│  ├─ src/  ├─ Dockerfile  └─ package.json
├─ services/
│  ├─ auth/                      # UC01, UC21
│  │  ├─ src/{routes,controllers,services,repositories,events}
│  │  ├─ prisma/schema.prisma    # schema "auth"
│  │  ├─ Dockerfile └─ package.json
│  ├─ tour/                      # UC02,03,07-11,13,17,18 (PostGIS)
│  ├─ moderation/                # UC15,19,06,20,22 (Gemini, state machine)
│  ├─ media/                     # worker TTS/translate → S3
│  └─ notification/              # UC16
├─ shared/
│  ├─ events/                    # tên event + payload schema (zod)
│  ├─ middleware/                # verifyJwt, errorHandler, logger
│  └─ rabbitmq/                  # helper connect/publish/consume
├─ client/                       # React PWA (Tourist + Contributor + Admin)
└─ infra/
   └─ postgres/init/             # enable PostGIS + tạo schema auth/tour/...
```

---

## 9. docker-compose (khung)

```yaml
services:
  gateway:      # :8080 → public
    build: ./gateway
    depends_on: [auth, tour, moderation, redis]
  auth:
    build: ./services/auth
    depends_on: [redis, rabbitmq]
  tour:
    build: ./services/tour
    depends_on: [redis, rabbitmq, postgres]
  moderation:
    build: ./services/moderation
    depends_on: [rabbitmq, postgres]
  media:        # worker, không expose port
    build: ./services/media
    depends_on: [rabbitmq]
  notification:
    build: ./services/notification
    depends_on: [rabbitmq]
  rabbitmq:     # :5672 + UI :15672
    image: rabbitmq:3-management
  redis:
    image: redis:7-alpine
  postgres:     # chỉ DEV local; team chung trỏ Supabase qua .env
    image: postgis/postgis:16-3.4
    volumes: ["./infra/postgres/init:/docker-entrypoint-initdb.d"]
```

---

## 10. Quyết định kỹ thuật quan trọng (team phải nhớ)

1. **Web Speech API KHÔNG dùng cho offline.** Nó đọc trực tiếp trong trình duyệt, không xuất file → không cache được. Luồng offline **bắt buộc dùng Google Cloud TTS** (xuất .mp3 → S3). Web Speech API chỉ để nghe thử lúc dev.
2. **Pre-render TTS chạy async** qua RabbitMQ worker (Media service), **không** render đồng bộ lúc user bấm tải.
3. **PostGIS bật từ migration đầu** — query vùng kích hoạt / "tour gần tôi" trong DB.
4. **OTP chỉ qua email** (Nodemailer) ở giai đoạn này; SMS tốn phí để sau.
5. **Schema-per-service** — service không truy cập bảng của nhau, chỉ qua API/event.
6. **PWA trước, React Native sau** cho Tourist: PWA không theo dõi GPS khi app chạy nền/khóa màn hình → geofencing nền thật cần RN ở giai đoạn 2. Backend/API thiết kế dùng lại được.
7. **Giao tiếp service: REST (sync) + RabbitMQ (async). KHÔNG dùng gRPC** ở giai đoạn này. Lý do: phần lớn luồng nặng là async qua RabbitMQ nên sync call liên service ít; gRPC thêm tooling (protobuf/codegen), khó debug, và browser không gọi trực tiếp được (client↔gateway vẫn phải REST) → đi ngược mục tiêu build nhanh. Cần "hợp đồng mạnh" thì dùng **zod schema dùng chung** trong `shared/`. gRPC để ngỏ cho giai đoạn sau nếu muốn học (chỉ áp dụng service↔service nội bộ).

---

## 11. Việc còn mở (quyết sau)

- **Data model chi tiết** (bảng/cột/quan hệ từng schema) + **sơ đồ trạng thái tour**.
- **Event contract** chi tiết (payload từng event, zod schema trong `shared/events`).
- **Thiết kế REST API** cho 13 UC làm trước.
- Nâng cấp **geocoding** (Nominatim → Mapbox/Google) nếu cần.
- UC05 (Đánh giá, P0) đang để ở nhóm làm sau — **tạm bỏ qua**, có thể xem lại sau.
