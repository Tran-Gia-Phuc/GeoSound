# UC22 – Dashboard thống kê và log

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC22 |
| **Use Case Name** | Dashboard thống kê và log |
| **Actor(s)** | Admin (Quản trị viên kiểm duyệt) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Admin xem dashboard thống kê vận hành (tour đang chờ duyệt, thời gian xử lý trung bình, tour bị report trong tuần, top contributor) và xem log hành động của các admin để quản lý khối lượng công việc và minh bạch vận hành. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Admin mở **"Dashboard"**. | |
| 2 | | Hệ thống hiển thị các chỉ số: số tour đang chờ duyệt, thời gian xử lý trung bình, số tour bị report trong tuần, top contributor theo chất lượng. *A1, E1* |
| 3 | Admin mở mục **"Nhật ký hành động"**. | |
| 4 | | Hệ thống hiển thị log: ai duyệt tour nào, ai ban user nào, vào lúc nào. |
| 5 | Admin lọc log theo admin / thời gian / loại hành động. *A2* | |
| 6 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Lọc dashboard theo khoảng thời gian** → hệ thống hiển thị lại số liệu theo khoảng thời gian.

**A2. Tìm/lọc log** → hệ thống hiển thị các bản ghi log khớp.

## Exception Path

- **E1.** Chưa có dữ liệu → hiển thị dashboard trống.

## Extension Points

- UC19 – Duyệt / từ chối tour; UC20 – Xử lý báo cáo & vi phạm; UC21 – Quản lý tài khoản vi phạm (các nguồn sinh log).

## Triggers

Admin muốn theo dõi vận hành và kiểm tra nhật ký hành động.

## Assumptions

- Hệ thống có ghi log hành động và thu thập số liệu.

## Preconditions

- Admin đã đăng nhập.

## Post Conditions

- Admin nắm được tình hình vận hành và lịch sử hành động của các admin.

## Reference: Business Rules

- Log hành động là **bản ghi bất biến (audit trail)** để minh bạch vận hành.
- Dashboard phục vụ quản lý khối lượng công việc kiểm duyệt.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang Dashboard (biểu đồ chỉ số), Trang Nhật ký hành động (log + bộ lọc).
