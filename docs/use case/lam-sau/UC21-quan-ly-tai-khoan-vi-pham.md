# UC21 – Quản lý tài khoản vi phạm

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC21 |
| **Use Case Name** | Quản lý tài khoản vi phạm |
| **Actor(s)** | Admin (Quản trị viên kiểm duyệt) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Admin tạm khóa hoặc ban hẳn tài khoản contributor vi phạm nhiều lần (dựa trên log lịch sử vi phạm) để chống tái phạm. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Admin mở trang quản lý người dùng / hồ sơ một contributor. | |
| 2 | | Hệ thống hiển thị thông tin tài khoản và **lịch sử vi phạm** (tour bị ẩn/từ chối, số lượt report). *E1* |
| 3 | Admin chọn hành động: Cảnh báo / Tạm khóa / Ban. *A1* | |
| 4 | Admin nhập lý do xử lý. | |
| 5 | | Hệ thống áp dụng (tạm khóa có thời hạn hoặc ban vĩnh viễn), ghi log (UC22) và thông báo cho người dùng. |
| 6 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Gỡ khóa / bỏ ban tài khoản** → hệ thống khôi phục quyền truy cập và ghi log.

## Exception Path

- **E1.** Tài khoản không tồn tại → thông báo *"Không tìm thấy tài khoản"*.

## Extension Points

- UC01 – Xác thực tài khoản (tài khoản bị ban không đăng nhập được); UC20 – Xử lý báo cáo & vi phạm; UC22 – Dashboard thống kê & log.

## Triggers

Contributor vi phạm nhiều lần; Admin cần xử lý tài khoản.

## Assumptions

- Có log lịch sử vi phạm của tài khoản.

## Preconditions

- Admin đã đăng nhập; tài khoản mục tiêu tồn tại.

## Post Conditions

- Tài khoản bị tạm khóa/ban hoặc được gỡ khóa; hành động được ghi log; người dùng được thông báo.

## Reference: Business Rules

- Quyết định ban dựa trên **lịch sử vi phạm (log)**.
- Tài khoản bị ban **không thể đăng nhập** (UC01 – Exception E3).
- Mọi hành động khóa/ban/gỡ được **ghi log** (UC22).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang Quản lý người dùng, Hồ sơ tài khoản + lịch sử vi phạm, Hộp thoại Khóa/Ban.
