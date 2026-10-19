# UC12 – Cấu hình đa ngôn ngữ và TTS

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC12 |
| **Use Case Name** | Cấu hình đa ngôn ngữ và TTS |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung chọn ngôn ngữ gốc và các ngôn ngữ phụ (hệ thống tự dịch + TTS), nghe thử TTS từng điểm theo từng ngôn ngữ và chỉnh text/bản dịch nếu sai, đồng thời chọn giọng đọc TTS cho tour để phục vụ khách quốc tế. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở mục **"Ngôn ngữ & giọng đọc"** của tour. | |
| 2 | | Hệ thống hiển thị ngôn ngữ gốc và cho phép chọn các ngôn ngữ phụ. |
| 3 | Contributor chọn các ngôn ngữ phụ cần hỗ trợ. | |
| 4 | | Hệ thống tự động **dịch text** sang các ngôn ngữ phụ và chuẩn bị bản TTS. *E1* |
| 5 | Contributor chọn **giọng đọc TTS** (nam/nữ, vùng miền). | |
| 6 | Contributor nghe thử bản TTS của từng điểm theo từng ngôn ngữ. *A1* | |
| 7 | Contributor chỉnh text gốc hoặc bản dịch nếu nghe sai tên riêng/thuật ngữ. *A2* | |
| 8 | Contributor lưu cấu hình ngôn ngữ. | |
| 9 | | Hệ thống lưu các ngôn ngữ, bản dịch và giọng TTS. |
| 10 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Nghe thử TTS** → hệ thống phát bản TTS tương ứng.

**A2. Chỉnh text / bản dịch** → hệ thống render lại TTS cho phần đã chỉnh, quay về bước 6.

## Exception Path

- **E1.** Lỗi dịch/TTS (dịch vụ không phản hồi) → thông báo, cho thử lại.

## Extension Points

- UC10 – Thêm & quản lý địa điểm (nguồn text gốc); UC15 – Gửi tour đi duyệt.

## Triggers

Contributor muốn tour phục vụ khách quốc tế mà không phải tự thu nhiều audio.

## Assumptions

- Dịch vụ dịch và TTS khả dụng.

## Preconditions

- Tour đã có text mô tả cho các điểm (UC10); contributor đã đăng nhập.

## Post Conditions

- Tour hỗ trợ nhiều ngôn ngữ với bản dịch + TTS và giọng đọc đã chọn.

## Reference: Business Rules

- **Ngôn ngữ gốc** là nguồn; **ngôn ngữ phụ** được tự động dịch + TTS.
- Khi tourist tải tour (UC03), audio TTS được **pre-render & cache** để chạy offline.
- Khi phát (UC04): ưu tiên audio người thật đúng ngôn ngữ; không có → TTS.
- *Nghe thử TTS, chỉnh text/giọng* là các action trong use case này (C24–C26).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Mục "Ngôn ngữ & giọng đọc", Bộ chọn ngôn ngữ phụ, Bộ chọn giọng TTS, Trình nghe thử TTS.
