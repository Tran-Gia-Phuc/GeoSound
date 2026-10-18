# UC05 – Đánh giá và nhận xét tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC05 |
| **Use Case Name** | Đánh giá và nhận xét tour |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Sau khi đi/nghe xong tour, khách du lịch chấm sao và viết nhận xét để giúp người khác chọn tour và giúp tác giả cải thiện nội dung. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist chọn **"Đánh giá"** (sau khi kết thúc tour ở UC04, hoặc từ chi tiết tour UC02). | |
| 2 | | Hệ thống hiển thị form đánh giá: số sao (1–5), ô nhận xét, tùy chọn đính kèm ảnh. *E1* |
| 3 | Tourist chọn số sao và nhập nhận xét. *E2* | |
| 4 | Tourist nhấn **"Gửi"**. | |
| 5 | | Hệ thống lưu đánh giá, cập nhật điểm trung bình của tour và hiển thị nhận xét. |
| 6 | | Hệ thống thông báo *"Cảm ơn đánh giá của bạn"*. |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Sửa / xóa đánh giá của mình.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Tourist mở đánh giá đã gửi, chọn Sửa hoặc Xóa. | |
| A1.2 | | Hệ thống cập nhật/xóa đánh giá và tính lại điểm trung bình. |

## Exception Path

- **E1.** Chưa đăng nhập (nếu chính sách yêu cầu) → gợi ý đăng nhập (UC01).
- **E2.** Gửi khi chưa chọn sao → thông báo *"Vui lòng chọn số sao"*.

## Extension Points

- UC01 – Xác thực tài khoản (nếu cần đăng nhập để đánh giá).

## Triggers

Tourist đã trải nghiệm tour và muốn để lại đánh giá.

## Assumptions

- Tourist đã đi hoặc nghe tour.

## Preconditions

- Tour tồn tại; tourist đã (hoặc đang) trải nghiệm tour.

## Post Conditions

- Đánh giá được lưu; điểm trung bình và thống kê tour được cập nhật (phục vụ UC17).

## Reference: Business Rules

- Mỗi tài khoản đánh giá **một lần/tour** (có thể sửa lại).
- Nội dung nhận xét có thể bị kiểm duyệt; đánh giá gắn tài khoản để chống spam.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình kết thúc tour (nút Đánh giá), Form đánh giá, Danh sách đánh giá của tour.
