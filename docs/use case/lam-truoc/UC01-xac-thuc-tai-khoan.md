# UC01 – Xác thực tài khoản (Đăng ký / Đăng nhập)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC01 |
| **Use Case Name** | Xác thực tài khoản (Đăng ký / Đăng nhập) |
| **Actor(s)** | Khách du lịch (Tourist), Người đăng nội dung (Contributor), Admin |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Người dùng đăng ký tài khoản mới (qua email/SĐT và xác thực OTP) hoặc đăng nhập tài khoản đã có để truy cập các tính năng theo vai trò (Tourist đồng bộ dữ liệu, Contributor quản lý nội dung, Admin kiểm duyệt). |

## Basic Course of Events *(Đăng nhập)*

| # | Actor Action | System Response |
|---|---|---|
| 1 | Người dùng chọn **"Đăng nhập"** (nếu chưa có tài khoản → *A1 Đăng ký*). | |
| 2 | | Hệ thống hiển thị form đăng nhập: Email/SĐT, Mật khẩu. |
| 3 | Người dùng nhập thông tin đăng nhập. *E1* | |
| 4 | Người dùng nhấn **"Đăng nhập"**. | |
| 5 | | Hệ thống xác thực thông tin. *E2, E3* |
| 6 | | Hệ thống xác định vai trò và điều hướng đến giao diện tương ứng: Tourist → màn hình chính; Contributor → trang quản lý nội dung; Admin → trang kiểm duyệt. |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Đăng ký (người dùng mới).**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Người dùng chọn **"Đăng ký"**. | |
| A1.2 | | Hệ thống hiển thị form đăng ký: Họ tên, Email/SĐT, Mật khẩu, Xác nhận mật khẩu, loại tài khoản (Khách / Người đăng nội dung). |
| A1.3 | Người dùng nhập thông tin. *E4, E5, E6* | |
| A1.4 | Người dùng nhấn **"Tiếp tục"**. | |
| A1.5 | | Hệ thống kiểm tra email/SĐT chưa tồn tại. *E7* |
| A1.6 | | Hệ thống gửi mã OTP đến email/SĐT. |
| A1.7 | Người dùng nhập OTP. *A3* | |
| A1.8 | | Hệ thống xác thực OTP. *E8* |
| A1.9 | | Hệ thống tạo tài khoản, thông báo *"Đăng ký thành công"* và quay về bước 1 (đăng nhập). |

**A2. Quên mật khẩu.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Người dùng chọn "Quên mật khẩu", nhập email/SĐT. | |
| A2.2 | | Hệ thống gửi OTP, cho đặt lại mật khẩu mới, rồi quay về bước 1. |

**A3. Gửi lại OTP.**

| # | Actor Action | System Response |
|---|---|---|
| A3.1 | Người dùng nhấn "Gửi lại OTP". | |
| A3.2 | | Hệ thống gửi mã OTP mới. |

## Exception Path

- **E1.** Bỏ trống thông tin đăng nhập → thông báo *"Vui lòng nhập đầy đủ"*.
- **E2.** Email/SĐT hoặc mật khẩu sai → thông báo; sai quá số lần quy định → tạm khóa đăng nhập.
- **E3.** Tài khoản bị khóa/ban → thông báo lý do, hướng dẫn liên hệ Admin (UC21).
- **E4.** Bỏ trống trường bắt buộc khi đăng ký → thông báo *"Vui lòng điền đầy đủ thông tin"*.
- **E5.** Email/SĐT sai định dạng → thông báo *"Email/Số điện thoại không hợp lệ"*.
- **E6.** Mật khẩu không hợp lệ (quá ngắn, thiếu chữ/số) → thông báo *"Mật khẩu không hợp lệ"*.
- **E7.** Email/SĐT đã tồn tại → thông báo *"Tài khoản đã được đăng ký"*.
- **E8.** OTP sai hoặc hết hạn → thông báo *"OTP không hợp lệ, vui lòng thử lại"*.

## Extension Points

- Các use case theo vai trò sau khi đăng nhập (UC09 Quản lý tour của mình, UC19 Duyệt/từ chối tour, …).

## Triggers

Người dùng muốn truy cập tính năng cần tài khoản.

## Assumptions

- Người dùng có thiết bị nhận OTP (SMS/Email); hệ thống kết nối server OTP.

## Preconditions

- Để đăng nhập: tài khoản đã tồn tại và chưa bị ban.
- Để đăng ký: chưa có tài khoản với email/SĐT đó.

## Post Conditions

- Người dùng có tài khoản mới (đăng ký) và/hoặc đã đăng nhập, được điều hướng theo vai trò.

## Reference: Business Rules

- Một email/SĐT chỉ đăng ký được một tài khoản.
- Mật khẩu tối thiểu 8 ký tự, gồm chữ và số; OTP hợp lệ trong 2 phút.
- Phân quyền theo vai trò (Tourist / Contributor / Admin); sai mật khẩu nhiều lần → tạm khóa; tài khoản bị ban không đăng nhập được (UC21).
- **Khách du lịch không bắt buộc đăng ký** để dùng tính năng cơ bản (tìm/tải/đi tour); chỉ cần tài khoản khi muốn đồng bộ. Contributor/Admin bắt buộc có tài khoản.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Đăng nhập, Form Đăng ký, Màn hình nhập OTP, Màn hình Quên mật khẩu, Giao diện theo vai trò.
