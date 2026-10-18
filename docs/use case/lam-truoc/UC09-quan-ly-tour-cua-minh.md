# UC09 – Quản lý tour của mình (tạo / sửa / xóa)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC09 |
| **Use Case Name** | Quản lý tour của mình (tạo / sửa / xóa) |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung tạo tour mới (tên, mô tả, ảnh bìa, ngôn ngữ gốc), xem danh sách tour của mình kèm trạng thái, sửa hoặc xóa tour (kể cả sau khi đã công khai) để giữ nội dung luôn chính xác. |

## Basic Course of Events *(Tạo tour mới)*

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor vào trang quản lý nội dung. | |
| 2 | | Hệ thống hiển thị danh sách tour của contributor kèm trạng thái: Nháp / Chờ AI / AI Warning / Chờ Admin duyệt / Công khai / Bị từ chối / Truy cập hạn chế / Đang bị ẩn. *E1* |
| 3 | Contributor chọn **"Tạo tour mới"** (hoặc *A1 Sửa / A2 Xóa / A3 Gửi duyệt* một tour có sẵn). | |
| 4 | | Hệ thống hiển thị form tạo tour: tên, mô tả ngắn, ảnh bìa, **ngôn ngữ gốc (bắt buộc)**, loại tour. *E2, E3* |
| 5 | Contributor nhập thông tin và upload ảnh bìa. | |
| 6 | | (Upload ảnh bìa) Hệ thống tự quét NSFW tại trình duyệt. *E4* |
| 7 | Contributor nhấn **"Tạo"**. | |
| 8 | | Hệ thống tạo tour ở trạng thái **"Nháp"** và mở trình chỉnh sửa để thêm địa điểm (**UC10**). |
| 9 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Sửa tour.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Contributor chọn Sửa một tour. | |
| A1.2 | | Hệ thống mở trình chỉnh sửa (UC10 – địa điểm, UC11 – route). |

**A2. Xóa tour.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Contributor chọn Xóa một tour, xác nhận. | |
| A2.2 | | Hệ thống xóa tour (kể cả tour công khai) và gỡ khỏi kết quả tìm kiếm (UC02). |

**A3. Gửi tour đi duyệt.**

| # | Actor Action | System Response |
|---|---|---|
| A3.1 | Contributor chọn "Gửi duyệt" một tour Nháp. | |
| A3.2 | | Hệ thống chuyển sang **UC15 – Gửi tour đi duyệt**. |

**A4. Lưu nháp và thoát** → hệ thống lưu tour ở trạng thái Nháp, quay về danh sách.

## Exception Path

- **E1.** Chưa có tour nào → danh sách rỗng, gợi ý tạo tour.
- **E2.** Thiếu trường bắt buộc (tên, ngôn ngữ gốc) → yêu cầu nhập đầy đủ.
- **E3.** Ảnh bìa sai định dạng/quá lớn → yêu cầu chọn ảnh khác.
- **E4.** Ảnh bìa vi phạm NSFW → **từ chối upload** và thông báo ngay.

## Extension Points

- UC10 – Thêm & quản lý địa điểm; UC11 – Vẽ route & cấu hình kích hoạt; UC15 – Gửi tour đi duyệt.

## Triggers

Contributor muốn tạo tour mới hoặc quản lý/chỉnh sửa tour của mình.

## Assumptions

- Contributor đã đăng nhập.

## Preconditions

- Contributor có tài khoản hợp lệ (đã đăng nhập – UC01).

## Post Conditions

- Tour mới được tạo (Nháp) hoặc tour hiện có được sửa/xóa/gửi duyệt.

## Reference: Business Rules

- Tour mới mặc định **Nháp**; **ngôn ngữ gốc bắt buộc**; ảnh quét NSFW client-side (NSFW.js).
- Chỉ **tác giả** tạo tour; khách du lịch không tạo tour.
- Contributor sửa/xóa được tour của mình **kể cả sau khi công khai**; sửa tour công khai có thể phải **gửi duyệt lại**.
- *Tạo, xem danh sách, sửa, xóa* là các action trong cùng use case này (gộp từ C3 + C4/C5).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang Quản lý nội dung (danh sách + trạng thái), Form Tạo tour, Trình chỉnh sửa tour, Hộp thoại xác nhận xóa.
