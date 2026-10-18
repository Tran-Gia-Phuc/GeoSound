# UC03 – Quản lý tour offline (tải / xem / xóa)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC03 |
| **Use Case Name** | Quản lý tour offline (tải / xem / xóa) |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch tải tour về máy để dùng offline, xem danh sách các tour đã tải và xóa tour không cần để quản lý dung lượng thiết bị. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist (từ chi tiết tour – UC02) xác nhận ngôn ngữ và nhấn **"Tải tour"**. | |
| 2 | | Hệ thống kiểm tra dung lượng trống và kết nối mạng. *E1, E2* |
| 3 | | Hệ thống chuẩn bị gói tải: text, ảnh, dữ liệu bản đồ/route/vùng kích hoạt, audio người thật (nếu có) và **audio TTS pre-render** theo ngôn ngữ đã chọn. |
| 4 | | Hệ thống tải và hiển thị tiến trình. *A1, E3* |
| 5 | | Hệ thống lưu tour, đánh dấu **"Đã tải"** và thông báo *"Tải tour thành công"*. |
| 6 | Tourist mở mục **"Tour đã tải"** để xem danh sách (dung lượng, ngôn ngữ) và quản lý. *A2, A3* | |
| 7 | | Hệ thống hiển thị danh sách tour đã tải và tổng dung lượng đang dùng. *E4* |
| 8 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Tạm dừng / hủy tải.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Tourist nhấn Tạm dừng hoặc Hủy khi đang tải. | |
| A1.2 | | Hệ thống dừng tải; hủy → dọn dữ liệu tải dở; tạm dừng → giữ phần đã tải. |

**A2. Xóa tour đã tải.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Tourist chọn Xóa một tour, xác nhận. | |
| A2.2 | | Hệ thống xóa dữ liệu tour khỏi máy và cập nhật dung lượng. |

**A3. Thêm/xóa một ngôn ngữ của tour đã tải; mở tour để đi.**

| # | Actor Action | System Response |
|---|---|---|
| A3.1 | Tourist tải thêm/xóa một ngôn ngữ, hoặc chọn "Bắt đầu" một tour đã tải. | |
| A3.2 | | Hệ thống cập nhật gói ngôn ngữ, hoặc chuyển sang **UC04 – Nghe tour** (chạy offline). |

## Exception Path

- **E1.** Không đủ dung lượng → thông báo, gợi ý xóa bớt tour (A2).
- **E2.** Không có mạng khi tải → thông báo cần kết nối Wi-Fi/internet.
- **E3.** Lỗi/mất mạng giữa chừng → thông báo, cho **Tiếp tục/Thử lại**, giữ phần đã tải.
- **E4.** Chưa tải tour nào → danh sách rỗng, gợi ý tìm tour (UC02).

## Extension Points

- UC02 – Tìm & xem tour; UC04 – Nghe tour.

## Triggers

Tourist muốn chuẩn bị tour để dùng offline hoặc quản lý dung lượng.

## Assumptions

- Thiết bị có đủ dung lượng và có Wi-Fi/internet lúc tải.

## Preconditions

- Tour ở trạng thái công khai; tourist đã chọn ngôn ngữ (UC02).

## Post Conditions

- Tour (kèm audio theo ngôn ngữ) được lưu/xoá trên máy; sẵn sàng dùng offline (UC04).

## Reference: Business Rules

- Audio TTS **pre-render & cache khi tải** để đảm bảo chạy offline (UC04).
- Tải theo ngôn ngữ đã chọn; có thể tải thêm nhiều ngôn ngữ.
- Dữ liệu tải lưu cục bộ; xóa tour giải phóng dung lượng.
- *Tải, xem danh sách, xóa* là các action trong cùng use case này (gộp từ T5 + T6).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Nút "Tải tour" (chi tiết tour), Thanh tiến trình tải, Màn hình Tour đã tải (danh sách + dung lượng), Hộp thoại xác nhận xóa.
