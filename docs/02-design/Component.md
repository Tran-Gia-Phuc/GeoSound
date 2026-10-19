# Component diagram – Hệ thống GeoSound (audio guide du lịch theo GPS)

File draw.io nằm ở [`drawio/Component.xml`](drawio/Component.xml). Bản Mermaid nằm ở [`drawio/Component.mmd`](drawio/Component.mmd).

Nguồn kiến trúc: [`../tech-stack.md`](../tech-stack.md). Cập nhật: 2026-10-18.

Cách đọc:

- Khung trắng là `«component»` (1 service / 1 app). Bên trong là module chính của service đó.
- Ký hiệu tròn gắn ổ cắm là Provided/Required Interface. Đầu tròn nằm phía component **cung cấp**, ổ cắm nằm phía component **yêu cầu**.
- Nét đứt cắm vào ổ cắm là **mối nối REST / đồng bộ**: component ở đầu nét đứt dùng interface đó.
- Ô `«requires»` liệt kê các interface mà component cần.
- Mũi tên xanh tới hình trụ là **schema** mà service đó sở hữu trong Postgres dùng chung (schema-per-service).
- Khung cam `«external»` là **dịch vụ bên ngoài** (SaaS). Hệ thống gọi ra ngoài qua REST; không có service nào của GeoSound chạy ở đó.

Giao tiếp giữa các service đúng theo tech-stack: **REST (đồng bộ)** cho luồng gọi trực tiếp và **RabbitMQ (bất đồng bộ)** cho event/job nặng. **Không dùng gRPC** ở giai đoạn này. Browser chỉ nói chuyện với **API Gateway** (1 cửa vào); Gateway verify JWT + rate-limit (qua Redis) rồi route tới service. Phụ thuộc đi một chiều: PWA → Gateway → service; service → service / hạ tầng / SaaS. Việc nặng (render TTS) đi async qua RabbitMQ, không chặn request.

## Interface (REST / hạ tầng – đồng bộ)

| Interface | Cung cấp | Yêu cầu | Việc interface này làm |
|---|---|---|---|
| IGateway | API Gateway | React PWA | 1 cửa vào duy nhất: verify JWT, rate-limit, route tới service |
| IAuth | Auth Service | API Gateway | Đăng ký/đăng nhập, OTP, phát/refresh JWT, phân quyền 3 vai trò, ban tài khoản |
| ITour | Tour Service | API Gateway, Moderation | CRUD tour/điểm/route/vùng kích hoạt, tìm kiếm (PostGIS), đóng gói offline, trang tác giả |
| IModeration | Moderation Service | API Gateway, Tour | Pipeline kiểm duyệt 3 tầng, hàng chờ Admin, state machine trạng thái tour, ghi log |
| ICache | Redis | API Gateway, Auth, Tour | Cache đọc nóng, OTP (TTL 2 phút), rate-limit, blacklist/refresh JWT |
| IMessageBus | RabbitMQ | Tour, Moderation, Media, Notification | Phát/nhận event & job bất đồng bộ (pub/sub) |
| IGenAI | Gemini API *(external)* | Moderation | Kiểm duyệt text Tầng 1 (server-side) |
| ITTS | Google Cloud TTS + Translate *(external)* | Media/TTS Worker | Dịch + sinh giọng → file .mp3 |
| IObjectStore | AWS S3 *(external)* | Tour, Media/TTS Worker | Lưu & phát ảnh, audio người thật, audio TTS |
| IEmail | Email/SMTP – Nodemailer *(external)* | Auth, Notification | Gửi OTP và thông báo qua email |

> Media/TTS Worker và Notification Service **không cung cấp interface REST** — chúng là consumer, chỉ nhận việc qua `IMessageBus` rồi gọi ra SaaS. Vì vậy trên sơ đồ chúng không có đầu tròn provided.

## Event bất đồng bộ (qua RabbitMQ / IMessageBus)

| Event | Phát bởi | Tiêu thụ bởi | Ý nghĩa |
|---|---|---|---|
| `tour.submitted` | Tour | Moderation | Contributor gửi duyệt → chạy AI (Tầng 1) |
| `tour.ai_passed` / `tour.ai_rejected` | Moderation | Tour, Notification | Kết quả AI; rejected → trả về sửa |
| `tour.approved` | Moderation | Media, Notification | Admin duyệt → kích hoạt render TTS + báo contributor |
| `tts.render.requested` | Moderation/Tour | Media | Yêu cầu render tất cả ngôn ngữ |
| `tts.render.completed` | Media | Tour | Audio .mp3 đã lên S3, tour sẵn sàng tải nhanh |
| `tour.rejected` / `reported` / `hidden` | Moderation | Notification | Báo contributor kèm lý do (UC16) |

## Dữ liệu mỗi component giữ (schema-per-service)

Một Postgres **@ Supabase dùng chung** cho cả team; **mỗi service sở hữu một `schema` riêng** và **không đụng bảng** của service khác — chỉ giao tiếp qua API hoặc event. PostGIS bật từ migration đầu để query không gian ("GPS trong polygon vùng kích hoạt", "tour gần tôi") chạy trong DB.

| Component | Schema sở hữu | Nội dung chính |
|---|---|---|
| Auth Service | `auth` | tài khoản, vai trò, refresh token, trạng thái ban |
| Tour Service | `tour` | tour, điểm dừng, route, vùng kích hoạt (PostGIS), bản dịch, metadata offline, trang tác giả |
| Moderation Service | `moderation` | yêu cầu duyệt, kết quả AER (Pass/Warning/Reject), trạng thái tour, hàng chờ Admin, log kiểm duyệt |
| Media/TTS Worker | `media` | job render TTS, đường dẫn .mp3 trên S3, trạng thái cache |
| Notification Service | `notification` | thông báo in-app, hàng đợi email, trạng thái đã đọc |

File/binary (ảnh, audio người thật, audio TTS) **không nằm trong Postgres** mà ở **AWS S3** (`IObjectStore`); DB chỉ giữ đường dẫn.

## Phạm vi đợt này

13 UC làm trước (UC01, 02, 03, 04, 07, 08, 09, 10, 11, 12, 13, 15, 19) được phục vụ bởi API Gateway + 5 service (Auth, Tour, Moderation, Media/TTS, Notification) đúng theo bảng phân rã trong [`../tech-stack.md`](../tech-stack.md). 9 UC còn lại (nhóm `lam-sau/`) tái dùng chính các service này, không thêm service mới.
