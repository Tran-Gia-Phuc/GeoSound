# UC07 – Tạo và quản lý lịch trình cá nhân

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC07 |
| **Use Case Name** | Tạo và quản lý lịch trình cá nhân |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch tìm/chọn các địa điểm riêng lẻ, tạo lịch trình cá nhân (đặt tên, thêm/sắp xếp/xóa điểm), xem lịch trình trên bản đồ với khoảng cách & thời gian ước tính, tải về offline và chia sẻ cho bạn bè. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist chọn **"Khám phá địa điểm"** để tìm địa điểm lẻ. *A1, E1* | |
| 2 | | Hệ thống hiển thị bản đồ/danh sách địa điểm kèm ô tìm kiếm và bộ lọc. |
| 3 | Tourist chọn một địa điểm để xem chi tiết (tên, loại, mô tả, ảnh, audio nếu có). | |
| 4 | Tourist chọn **"Thêm vào lịch trình"**. | |
| 5 | | Hệ thống yêu cầu đặt tên lịch trình (nếu chưa có). *E2* |
| 6 | Tourist thêm các địa điểm, sắp xếp thứ tự, thêm/xóa điểm. *A2* | |
| 7 | | Hệ thống hiển thị lịch trình trên bản đồ kèm **khoảng cách và thời gian di chuyển ước tính**. |
| 8 | Tourist tải lịch trình offline hoặc chia sẻ cho bạn bè. *A3, A4* | |
| 9 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Tìm / lọc địa điểm** → hệ thống hiển thị kết quả theo bộ lọc.

**A2. Sắp xếp / thêm / xóa địa điểm** → hệ thống cập nhật lịch trình và tính lại khoảng cách/thời gian.

**A3. Tải lịch trình offline** → hệ thống tải dữ liệu lịch trình (và audio các điểm) về máy.

**A4. Chia sẻ lịch trình (tùy chọn)** → hệ thống tạo liên kết/mã chia sẻ.

## Exception Path

- **E1.** Không tìm thấy địa điểm phù hợp → gợi ý địa điểm gần/phổ biến.
- **E2.** Thiếu tên lịch trình → yêu cầu nhập tên.

## Extension Points

- UC08 – Đi theo lịch trình cá nhân.

## Triggers

Tourist muốn tự lên kế hoạch chuyến đi từ các địa điểm quan tâm.

## Assumptions

- Tourist đã đăng nhập (lịch trình gắn tài khoản).

## Preconditions

- Tourist đã đăng nhập (UC01); hệ thống có dữ liệu địa điểm được phép hiển thị lẻ.

## Post Conditions

- Lịch trình cá nhân được tạo/lưu; có thể tải offline và chia sẻ.

## Reference: Business Rules

- Lịch trình gắn với tài khoản; chia sẻ là tùy chọn.
- Chỉ hiển thị địa điểm thuộc tour công khai hoặc địa điểm được phép hiển thị riêng lẻ.
- *Tìm địa điểm lẻ, sắp xếp/thêm/xóa, chia sẻ* là các action trong cùng use case này (gộp từ T16 + T17–T20/T22).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Khám phá địa điểm, Màn hình Chi tiết địa điểm, Trình chỉnh sửa lịch trình (bản đồ + danh sách điểm), Hộp thoại chia sẻ.
