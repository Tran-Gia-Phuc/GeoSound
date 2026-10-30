# UC23 – Quản lý thiết bị đang đăng nhập

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC23 |
| **Use Case Name** | Quản lý thiết bị đang đăng nhập |
| **Actor(s)** | Khách du lịch (Tourist), Người đăng nội dung (Contributor), Admin (người dùng đã đăng nhập) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Người dùng xem danh sách các thiết bị đang đăng nhập vào tài khoản của mình (ví dụ đăng nhập trên 3 điện thoại thì thấy 3 thiết bị), biết thiết bị nào đang cầm trên tay, và đăng xuất từ xa một thiết bị hoặc tất cả thiết bị khác. Nghiên cứu nghiệp vụ và thiết kế: [device-sessions.md](../../02-design/device-sessions.md). |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Người dùng vào **Tài khoản → "Thiết bị đang đăng nhập"**. | |
| 2 | | Hệ thống hiển thị danh sách thiết bị: tên thiết bị (vd *"Chrome trên Windows"*, *"Safari trên iPhone"*), vị trí gần đúng (thành phố, quốc gia), thời điểm đăng nhập, hoạt động gần nhất (*"Đang hoạt động"*, *"5 phút trước"*). Thiết bị hiện tại có nhãn **"Thiết bị này"** và đứng đầu; các thiết bị khác xếp theo hoạt động gần nhất. *E1* |
| 3 | Người dùng chọn một thiết bị khác và nhấn **"Đăng xuất thiết bị"**. *A1, A2* | |
| 4 | | Hệ thống hỏi xác nhận: *"Đăng xuất khỏi <tên thiết bị>?"*. |
| 5 | Người dùng xác nhận. | |
| 6 | | Hệ thống kết thúc phiên của thiết bị đó ngay lập tức, xóa thiết bị khỏi danh sách và thông báo *"Đã đăng xuất <tên thiết bị>"*. *E2, E3* |
| 7 | | Thiết bị bị đăng xuất, ở lần thao tác tiếp theo, quay về màn hình đăng nhập (UC01). |
| 8 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Đăng xuất tất cả thiết bị khác.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Người dùng nhấn **"Đăng xuất tất cả thiết bị khác"**. | |
| A1.2 | | Hệ thống hỏi xác nhận, nêu số thiết bị sẽ bị đăng xuất. |
| A1.3 | Người dùng xác nhận. | |
| A1.4 | | Hệ thống kết thúc mọi phiên trừ thiết bị hiện tại, danh sách chỉ còn "Thiết bị này", thông báo *"Đã đăng xuất N thiết bị"*. Use case kết thúc. |

**A2. Đăng xuất chính thiết bị đang dùng.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Người dùng nhấn **"Đăng xuất"** trên thiết bị hiện tại (không phải từ danh sách). | |
| A2.2 | | Hệ thống kết thúc phiên hiện tại và đưa về màn hình đăng nhập. Use case kết thúc. |

**A3. Hệ thống tự đăng xuất các thiết bị** (không cần người dùng mở danh sách).

- Đặt lại mật khẩu qua "Quên mật khẩu" (UC01 A2) → đăng xuất **tất cả** thiết bị.
- Đổi mật khẩu khi đang đăng nhập → đăng xuất tất cả thiết bị **trừ** thiết bị hiện tại.
- Tài khoản bị ban (UC21) → đăng xuất tất cả thiết bị.
- Thiết bị không hoạt động quá 7 ngày, hoặc đã đăng nhập quá 30 ngày → phiên hết hạn và biến mất khỏi danh sách.
- Đăng nhập thiết bị thứ 11 → thiết bị lâu không hoạt động nhất bị đăng xuất.
- Phát hiện refresh token cũ bị dùng lại (dấu hiệu bị đánh cắp) → đăng xuất thiết bị đó.

**A4. Cảnh báo đăng nhập trên thiết bị mới** *(P2)* → khi đăng nhập tạo ra một thiết bị mới, hệ thống gửi email *"Tài khoản của bạn vừa đăng nhập trên <thiết bị> tại <vị trí>"* kèm hướng dẫn vào UC23 để đăng xuất nếu không phải mình (UC16).

## Exception Path

- **E1.** Chỉ có thiết bị hiện tại → hiển thị một dòng "Thiết bị này", ẩn nút "Đăng xuất tất cả thiết bị khác".
- **E2.** Thiết bị đã bị đăng xuất hoặc hết hạn trước đó (vd ở một thiết bị khác) → thông báo *"Thiết bị này đã đăng xuất"* và làm mới danh sách.
- **E3.** Mất kết nối mạng → thông báo *"Không thể kết nối, vui lòng thử lại"*; phiên của thiết bị kia không bị thay đổi.

## Extension Points

- UC01 – Xác thực tài khoản (đăng nhập tạo thiết bị mới; quên mật khẩu đăng xuất tất cả); UC16 – Thông báo (cảnh báo thiết bị mới); UC21 – Quản lý tài khoản vi phạm (ban đăng xuất tất cả).

## Triggers

Người dùng muốn biết tài khoản đang đăng nhập ở đâu, hoặc nghi ngờ người khác dùng tài khoản của mình, hoặc làm mất / bán / cho mượn thiết bị.

## Assumptions

- Mỗi lần đăng nhập trên một trình duyệt / bản cài app được tính là một thiết bị; ứng dụng giữ một mã thiết bị ngẫu nhiên để đăng nhập lại trên cùng máy không sinh thêm dòng mới.
- Vị trí chỉ là gần đúng, suy ra từ địa chỉ IP; có thể là *"Không xác định"*.

## Preconditions

- Người dùng đã đăng nhập (UC01) và tài khoản không bị ban.

## Post Conditions

- Danh sách thiết bị phản ánh đúng các phiên còn hiệu lực; thiết bị bị đăng xuất không còn gọi được API (không phải chờ token hết hạn) và phải đăng nhập lại.

## Reference: Business Rules

- Mỗi thiết bị là một phiên đăng nhập; đăng nhập lại trên cùng thiết bị thay phiên cũ, không tạo thêm thiết bị.
- Danh sách chỉ hiển thị tên thiết bị, vị trí gần đúng và thời gian; **không hiển thị IP đầy đủ hay token**.
- Đăng xuất từ xa có hiệu lực **ngay lập tức**.
- Tối đa **10** thiết bị cùng lúc; vượt quá thì thiết bị lâu không hoạt động nhất bị đăng xuất.
- Phiên hết hạn sau **7 ngày không hoạt động**, tối đa **30 ngày** kể từ khi đăng nhập.
- Đặt lại mật khẩu / bị ban → đăng xuất tất cả thiết bị; đổi mật khẩu → đăng xuất các thiết bị khác.
- Dữ liệu IP và User-Agent chỉ lưu khi phiên còn hiệu lực và thêm 30 ngày sau khi kết thúc, rồi xóa.
- Admin không xem được thiết bị của người dùng khác trong UC này.
- *Cần nhóm chốt:* giới hạn 10 thiết bị, email cảnh báo thiết bị mới (P2), thời gian giữ dữ liệu 30 ngày.

## Author(s)

(điền sau)

## Date

2026-10-30

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Tài khoản, Màn hình "Thiết bị đang đăng nhập", Hộp thoại xác nhận đăng xuất thiết bị / tất cả thiết bị khác, Email cảnh báo đăng nhập mới.
