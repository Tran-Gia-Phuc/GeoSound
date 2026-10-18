# UC13 – Xem thử tour (preview)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC13 |
| **Use Case Name** | Xem thử tour (preview) |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung xem thử tour trong app như một khách thật (GPS giả lập, nghe audio, xem route) để kiểm tra trải nghiệm trước khi gửi duyệt/công khai. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor chọn **"Xem thử"** trên tour. | |
| 2 | | Hệ thống mở chế độ preview như khách: bản đồ, route, điểm, trình phát audio, với **GPS giả lập**. *E1* |
| 3 | Contributor di chuyển điểm GPS giả lập dọc route. *A1* | |
| 4 | | Hệ thống tự phát audio theo vùng kích hoạt giống trải nghiệm thật (như UC04). |
| 5 | Contributor xem text/ảnh, kiểm tra nội dung, audio và vùng kích hoạt. | |
| 6 | Contributor thoát preview; nếu phát hiện lỗi thì quay lại chỉnh sửa. *A2* | |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Chọn điểm thủ công để nghe thử** → hệ thống phát audio điểm đó không cần GPS giả lập.

**A2. Phát hiện lỗi → quay lại sửa** → hệ thống chuyển về trình chỉnh sửa (UC10 / UC11 / UC12).

## Exception Path

- **E1.** Tour thiếu dữ liệu (chưa có điểm hoặc route) → thông báo không thể preview, gợi ý bổ sung.

## Extension Points

- UC10 – Thêm & quản lý địa điểm; UC11 – Vẽ route & cấu hình kích hoạt; UC12 – Cấu hình đa ngôn ngữ & TTS; UC15 – Gửi tour đi duyệt.

## Triggers

Contributor muốn kiểm tra trải nghiệm tour trước khi gửi duyệt.

## Assumptions

- Chế độ GPS giả lập khả dụng trong app.

## Preconditions

- Tour đã có ít nhất một điểm và route (UC10, UC11); contributor đã đăng nhập.

## Post Conditions

- Contributor đã kiểm tra trải nghiệm tour; có thể sửa hoặc gửi duyệt.

## Reference: Business Rules

- Preview **không công khai**, chỉ để kiểm thử nội bộ.
- Preview dùng **GPS giả lập** và mô phỏng đúng trải nghiệm tourist (UC04).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Chế độ Preview (bản đồ + GPS giả lập), Trình phát audio, Màn hình nội dung điểm.
