# UC18 – Trang tác giả công khai

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC18 |
| **Use Case Name** | Trang tác giả công khai |
| **Actor(s)** | Người đăng nội dung (Contributor); Khách du lịch (Tourist – người xem) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung có trang tác giả hiển thị các tour công khai của mình để người dùng biết và theo dõi; khách du lịch có thể xem và theo dõi tác giả. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở/cấu hình trang tác giả (ảnh đại diện, giới thiệu). *A1* | |
| 2 | | Hệ thống hiển thị trang tác giả công khai kèm danh sách các tour **công khai** của contributor. *E1* |
| 3 | Tourist truy cập trang tác giả (từ một tour hoặc từ tìm kiếm). | |
| 4 | Tourist xem danh sách tour và theo dõi tác giả. *A2* | |
| 5 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Chỉnh sửa thông tin trang tác giả** → hệ thống lưu và cập nhật trang.

**A2. Theo dõi / bỏ theo dõi tác giả** → hệ thống cập nhật trạng thái theo dõi.

## Exception Path

- **E1.** Tác giả chưa có tour công khai → trang hiển thị trống.

## Extension Points

- UC02 – Tìm & xem tour (mở một tour từ trang tác giả); UC01 – Xác thực tài khoản (để theo dõi).

## Triggers

Người dùng muốn xem các tour của một tác giả.

## Assumptions

- Contributor có ít nhất một tour công khai (để trang có nội dung).

## Preconditions

- Contributor có tài khoản; trang tác giả được bật công khai.

## Post Conditions

- Trang tác giả hiển thị các tour công khai; tourist có thể theo dõi.

## Reference: Business Rules

- Chỉ hiển thị **tour công khai (đã duyệt)** trên trang tác giả.
- Theo dõi tác giả là tùy chọn (cần đăng nhập).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang tác giả công khai, Màn hình chỉnh sửa hồ sơ tác giả.
