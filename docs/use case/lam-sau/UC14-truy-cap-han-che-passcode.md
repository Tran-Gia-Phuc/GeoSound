# UC14 – Cấu hình truy cập hạn chế bằng passcode

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC14 |
| **Use Case Name** | Cấu hình truy cập hạn chế bằng passcode |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung đặt tour ở chế độ truy cập hạn chế (chỉ ai nhập mã passcode mới thấy) để test với nhóm nhỏ mà công chúng chưa thấy, không cần qua Admin duyệt. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor chọn **"Truy cập hạn chế"** cho tour. | |
| 2 | | Hệ thống cho phép đặt passcode cho tour. *E1* |
| 3 | Contributor đặt passcode và lưu. | |
| 4 | | Hệ thống chuyển tour sang trạng thái **"Truy cập hạn chế"** (không hiển thị công khai trong tìm kiếm). |
| 5 | Contributor chia sẻ passcode cho nhóm test. | |
| 6 | | (Phía người test) Nhập passcode → xem và tải được tour để test. |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Đổi hoặc hủy passcode.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Contributor đổi passcode hoặc tắt chế độ hạn chế. | |
| A1.2 | | Hệ thống cập nhật passcode, hoặc chuyển tour về Nháp khi tắt chế độ hạn chế. |

## Exception Path

- **E1.** Passcode không hợp lệ (quá ngắn/trống) → yêu cầu đặt lại.

## Extension Points

- UC13 – Xem thử tour; UC15 – Gửi tour đi duyệt (khi muốn công khai).

## Triggers

Contributor muốn test tour với nhóm nhỏ trước khi công khai.

## Assumptions

- Người test có passcode do contributor cung cấp.

## Preconditions

- Tour tồn tại (thường ở Nháp); contributor đã đăng nhập.

## Post Conditions

- Tour ở chế độ truy cập hạn chế; chỉ ai có passcode mới truy cập.

## Reference: Business Rules

- Chế độ truy cập hạn chế **không cần Admin duyệt** vì không công khai.
- Tour hạn chế **không xuất hiện** trong kết quả tìm kiếm công khai (UC02).
- Chỉ dùng cho mục đích test với nhóm nhỏ.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Cài đặt tour (chế độ truy cập), Hộp thoại đặt passcode, Màn hình nhập passcode (phía người test).
