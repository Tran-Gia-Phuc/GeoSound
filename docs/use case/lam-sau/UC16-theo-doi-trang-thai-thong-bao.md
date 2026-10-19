# UC16 – Theo dõi trạng thái và nhận thông báo kiểm duyệt

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC16 |
| **Use Case Name** | Theo dõi trạng thái và nhận thông báo kiểm duyệt |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung xem trạng thái tour trong luồng kiểm duyệt và nhận thông báo khi tour bị khách báo cáo (kèm lý do) hoặc bị Admin từ chối (kèm lý do), để kiểm tra và chỉnh sửa kịp thời. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở trang quản lý nội dung / trung tâm thông báo. | |
| 2 | | Hệ thống hiển thị trạng thái từng tour: Nháp / Chờ AI / AI Warning / Chờ Admin duyệt / Đã duyệt / Bị từ chối / Đang bị ẩn. |
| 3 | | Hệ thống hiển thị thông báo: tour bị khách báo cáo (kèm lý do) hoặc bị Admin từ chối/yêu cầu sửa (kèm lý do). *A1, E1* |
| 4 | Contributor mở một thông báo để xem chi tiết lý do. | |
| 5 | Contributor chuyển sang sửa tour và gửi duyệt lại nếu cần. *A2* | |
| 6 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Nhận thông báo đẩy (push)** → khi tour đổi trạng thái (duyệt/từ chối/bị ẩn/bị báo cáo), hệ thống gửi thông báo cho contributor.

**A2. Mở tour để sửa và gửi lại** → hệ thống mở trình chỉnh sửa (UC10 / UC11); sau khi sửa, contributor gửi duyệt lại (UC15).

## Exception Path

- **E1.** Không có thông báo nào → danh sách trống.

## Extension Points

- UC15 – Gửi tour đi duyệt; UC10 – Thêm & quản lý địa điểm; UC11 – Vẽ route & cấu hình kích hoạt.

## Triggers

Tour của contributor có thay đổi trạng thái hoặc bị báo cáo/từ chối.

## Assumptions

- Hệ thống thông báo hoạt động (in-app/push).

## Preconditions

- Contributor đã đăng nhập và có ít nhất một tour.

## Post Conditions

- Contributor nắm được trạng thái và lý do; có thể chỉnh sửa và gửi lại.

## Reference: Business Rules

- Thông báo luôn **kèm lý do cụ thể** (báo cáo / từ chối / yêu cầu sửa).
- Trạng thái tour phản ánh **mô hình kiểm duyệt 3 tầng**.
- Tour đạt ngưỡng báo cáo → "Chờ Admin xem lại" (liên quan UC06, UC20).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trung tâm thông báo, Trang Quản lý nội dung (cột trạng thái), Chi tiết thông báo.
