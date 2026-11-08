# Danh sách Use Case – Hệ thống GeoSound (audio guide du lịch)

> Nguồn: [ustory.md](ustory.md). Đánh số UC theo **flow người dùng**: Tài khoản → Khách du lịch (Tourist) → Người đăng nội dung (Contributor) → Admin.
> Tổng **24 use case**: 23 UC gốc (đã gộp từ bản 28) và **UC24 – Hỏi đáp với trợ lý AI**, thêm ngày 2026-11-08.
> **Cập nhật 2026-11-08:** cả 24 UC đã hiện thực (backend và màn hình). Mỗi file UC mô tả đúng hành vi của hệ thống hiện tại. Mục **"Hiện thực trong hệ thống"** của từng file liệt kê dịch vụ, màn hình, API, sự kiện và dữ liệu; mục **Sequence Diagram** dùng Mermaid.

## Tổ chức thư mục

Hai thư mục giữ theo **thứ tự triển khai ban đầu**, không còn mang nghĩa "chưa làm".

| Thư mục | Nội dung |
|---|---|
| `lam-truoc/` | **14 UC làm đợt 1**: danh sách chọn ban đầu, thêm UC08 cho trọn nhánh lịch trình và UC23 (thêm 2026-10-30) |
| `lam-sau/` | **10 UC làm đợt 2**: 9 UC còn lại (xong 2026-11-03 → 2026-11-08) và UC24 |

## Phân biệt Use Case vs Action

- **Use case**: mục tiêu hoàn chỉnh, có điểm bắt đầu và kết thúc, kết quả quan sát được.
- **Action**: một bước bên trong UC (vd *tua audio*, *thả pin*, *chọn ngôn ngữ*, *xem danh sách*). Action thuộc Basic/Alternative/Exception flow, không tách thành UC riêng.

## Kiến trúc tham chiếu

```text
Client (React PWA) ──HTTP──▶ Gateway (/api/*, rate limit) ──▶ Auth | Tour | Media | Notification | Moderation | AI
Tour ──place.submitted / tour.submitted──▶ RabbitMQ ──▶ Moderation ──HTTP──▶ AI (Gemini, dự phòng Groq)
Moderation ──*.ai_passed / *.ai_rejected──▶ RabbitMQ ──▶ Tour (quyết định trạng thái, hiển thị)
Tour / Auth ──tour.* / account.* / auth.*──▶ RabbitMQ ──▶ Notification (email + thông báo trong app)
Tour ──tour.published / tour.unpublished──▶ RabbitMQ ──▶ AI (chỉ mục RAG cho chatbot)
```

Chi tiết: [moderation-architecture.md](../02-design/moderation-architecture.md), [chatbot-architecture.md](../02-design/chatbot-architecture.md), [Component.md](../02-design/Component.md).

## 🟢 Đợt 1 (14 UC) — thư mục `lam-truoc/`

| UC | Tên use case | Actor | Priority | Dịch vụ chính | Gộp từ (bản 28) |
|---|---|---|---|---|---|
| UC01 | [Xác thực tài khoản (Đăng ký/Đăng nhập)](lam-truoc/UC01-xac-thuc-tai-khoan.md) | Tourist / Contributor / Admin | P0 | Auth | UC01+UC02 |
| UC02 | [Tìm & xem tour](lam-truoc/UC02-tim-va-xem-tour.md) | Tourist | P0 | Tour | UC03+UC04 |
| UC03 | [Quản lý tour offline (tải/xem/xóa)](lam-truoc/UC03-quan-ly-tour-offline.md) | Tourist | P0 | Tour, Client (IndexedDB, service worker) | UC05+UC06 |
| UC04 | [Nghe tour (GPS tại chỗ / từ xa)](lam-truoc/UC04-nghe-tour.md) | Tourist | P0 | Tour, Media, Client | UC07+UC10 |
| UC07 | [Tạo & quản lý lịch trình cá nhân](lam-truoc/UC07-lich-trinh-ca-nhan.md) | Tourist | P2 | Tour | UC11+UC12 |
| UC08 | [Đi theo lịch trình cá nhân](lam-truoc/UC08-di-theo-lich-trinh.md) | Tourist | P2 | Tour, Client | UC13 |
| UC09 | [Quản lý tour của mình (tạo/sửa/xóa)](lam-truoc/UC09-quan-ly-tour-cua-minh.md) | Contributor | P0 | Tour, Media | UC14+UC15 |
| UC10 | [Thêm & quản lý địa điểm trên tour](lam-truoc/UC10-them-quan-ly-dia-diem.md) | Contributor | P0 | Tour, Media | UC16 |
| UC11 | [Vẽ route & cấu hình kích hoạt audio](lam-truoc/UC11-ve-route-cau-hinh-kich-hoat.md) | Contributor | P0 | Tour | UC17 |
| UC12 | [Cấu hình đa ngôn ngữ & TTS](lam-truoc/UC12-da-ngon-ngu-tts.md) | Contributor | P1 | Tour, AI (dịch) | UC18 |
| UC13 | [Xem thử tour (preview)](lam-truoc/UC13-xem-thu-tour.md) | Contributor | P1 | Tour, Client | UC19 |
| UC15 | [Gửi tour đi duyệt – kiểm duyệt AI](lam-truoc/UC15-gui-tour-di-duyet.md) | Contributor + Moderation + AI | P0 | Tour, Moderation, AI | UC21 |
| UC19 | [Duyệt / từ chối tour](lam-truoc/UC19-duyet-tu-choi-tour.md) | Admin | P0 | Tour, Notification | UC25 |
| UC23 | [Quản lý thiết bị đang đăng nhập](lam-truoc/UC23-quan-ly-thiet-bi-dang-nhap.md) | Tourist / Contributor / Admin | P1 | Auth, Notification | mới (G1) |

## 🟡 Đợt 2 (10 UC) — thư mục `lam-sau/`

| UC | Tên use case | Actor | Priority | Dịch vụ chính | Gộp từ (bản 28) |
|---|---|---|---|---|---|
| UC05 | [Đánh giá & nhận xét tour](lam-sau/UC05-danh-gia-tour.md) | Tourist | P0 | Tour | UC08 |
| UC06 | [Báo cáo tour vi phạm](lam-sau/UC06-bao-cao-tour.md) | Tourist | P1 | Tour, Notification | UC09 |
| UC14 | [Cấu hình truy cập hạn chế bằng passcode](lam-sau/UC14-truy-cap-han-che-passcode.md) | Contributor | P2 | Tour | UC20 |
| UC16 | [Theo dõi trạng thái & nhận thông báo](lam-sau/UC16-theo-doi-trang-thai-thong-bao.md) | Contributor | P1 | Notification, Tour | UC22 |
| UC17 | [Xem thống kê & đánh giá tour](lam-sau/UC17-thong-ke-danh-gia-tour.md) | Contributor | P1 | Tour | UC23 |
| UC18 | [Trang tác giả công khai](lam-sau/UC18-trang-tac-gia.md) | Contributor | P2 | Auth, Tour | UC24 |
| UC20 | [Xử lý báo cáo & vi phạm tour](lam-sau/UC20-xu-ly-bao-cao-vi-pham.md) | Admin | P1 | Tour, Notification | UC26 |
| UC21 | [Quản lý tài khoản vi phạm](lam-sau/UC21-quan-ly-tai-khoan-vi-pham.md) | Admin | P2 | Auth, Tour, Notification | UC27 |
| UC22 | [Dashboard thống kê & log](lam-sau/UC22-dashboard-thong-ke-log.md) | Admin | P2 | Tour, Auth | UC28 |
| UC24 | [Hỏi đáp với trợ lý du lịch AI (chatbot)](lam-sau/UC24-hoi-dap-tro-ly-ai.md) | Tourist + AI | P1 | AI, Gateway | mới (2026-11-08) |

## 6 nhóm đã gộp

1. **UC01** = Đăng ký + Đăng nhập. 2. **UC02** = Tìm kiếm + Chi tiết tour. 3. **UC03** = Tải + Quản lý tour đã tải. 4. **UC04** = Đi tour (GPS) + Nghe thử từ xa. 5. **UC07** = Tìm địa điểm lẻ + Lịch trình cá nhân. 6. **UC09** = Tạo tour + Quản lý tour.

## Kiểm duyệt 3 tầng (xuyên suốt, theo hệ thống hiện tại)

- **Tầng 0, khi lưu điểm (UC10):** Tour chặn điểm nằm trong **vùng cấm** (dữ liệu seed, kiểm tra polygon ở Tour).
- **Tầng 1, AI tự động (UC15):**
  - Khi gửi duyệt, Tour phát `place.submitted` cho từng điểm và `tour.submitted`.
  - Moderation gọi AI: `/moderate/place` kiểm tra text và ảnh bằng Gemini, `/moderate/tour` kiểm tra text tour. Nhà cung cấp chính là Gemini; Groq dự phòng, chỉ cho text.
  - Moderation tự chạy luật địa lý G1–G6 cho route.
  - Ngưỡng: severity ≥ 0.8 là **Reject**, ≥ 0.4 là **Warning**, còn lại là **Pass**.
- **Tầng 2, Admin review (UC19):** duyệt, từ chối hoặc yêu cầu sửa. Tour có AI Warning được ưu tiên đầu hàng chờ.
- **Tầng 3, Community report:** khách báo cáo (UC06), Admin xử lý (UC20). Khi có báo cáo đang mở từ **5 tài khoản khác nhau trong 7 ngày**, tour được gắn cờ chờ Admin xem lại; hệ thống không tự ẩn tour.

## Khác biệt so với bản đặc tả đầu (2026-10-18)

- **Quét ảnh:** không dùng NSFW.js trên client; ảnh được Gemini kiểm tra ở AI service.
- **Vùng cấm:** không dùng turf.js; Tour kiểm tra polygon khi lưu điểm. Luật route G1–G6 chạy ở Moderation.
- **TTS:** chưa có render TTS phía server. Điểm không có audio ghi âm được đọc bằng giọng của thiết bị (Web Speech). Gói offline chỉ chứa text, ảnh và audio ghi âm.
- **Chatbot:** thêm UC24.
