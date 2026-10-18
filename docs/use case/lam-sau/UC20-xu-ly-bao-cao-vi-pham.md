# UC20 – Xử lý báo cáo và vi phạm tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC20 |
| **Use Case Name** | Xử lý báo cáo và vi phạm tour |
| **Actor(s)** | Admin (Quản trị viên kiểm duyệt) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Admin xem danh sách tour bị khách báo cáo (sắp theo số report giảm dần), xem chi tiết báo cáo, ẩn tour vi phạm kèm cảnh báo contributor, hoặc khôi phục tour bị báo cáo sai (report bomb). |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Admin mở trang **"Tour bị báo cáo"**. | |
| 2 | | Hệ thống hiển thị danh sách tour bị báo cáo, **sắp xếp theo số lượt report giảm dần**. *E1* |
| 3 | Admin chọn một tour để xem chi tiết các báo cáo (ai báo cáo, lý do, thời gian). | |
| 4 | Admin xem lại nội dung tour / preview để đánh giá. | |
| 5 | Admin ra quyết định: **Ẩn tour**. *A1, A2, A3* | |
| 6 | | Hệ thống chuyển tour sang **"Đang bị ẩn"**, gửi cảnh báo cho contributor kèm lý do (UC16) và ghi log (UC22). |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Khôi phục tour bị ẩn (báo cáo sai / report bomb)** → hệ thống chuyển tour về **"Công khai"**, ghi log.

**A2. Bỏ qua báo cáo (không vi phạm)** → hệ thống đóng báo cáo, giữ tour công khai, ghi log.

**A3. Vi phạm nhiều lần → xử lý tài khoản** → hệ thống chuyển sang **UC21 – Quản lý tài khoản vi phạm**.

## Exception Path

- **E1.** Không có tour bị báo cáo → danh sách rỗng.

## Extension Points

- UC16 – Theo dõi trạng thái & thông báo; UC21 – Quản lý tài khoản vi phạm; UC22 – Dashboard thống kê & log.

## Triggers

Có tour bị khách báo cáo hoặc tour đạt ngưỡng báo cáo tự động (UC06).

## Assumptions

- Có dữ liệu báo cáo từ cộng đồng.

## Preconditions

- Admin đã đăng nhập; có tour bị báo cáo hoặc ở "Chờ Admin xem lại".

## Post Conditions

- Tour được ẩn / khôi phục / giữ nguyên; hành động được ghi log; contributor được thông báo nếu bị ẩn.

## Reference: Business Rules

- Phần xử lý của **Tầng 3 – Community report**.
- Tour nhận **≥ 5 báo cáo khác nhau trong 7 ngày** tự chuyển "Chờ Admin xem lại" (UC06); không ẩn hẳn để Admin có thể khôi phục.
- Admin có thể **khôi phục** để bảo vệ contributor khỏi report bomb; mọi hành động ẩn/khôi phục được **ghi log** (UC22).
- *Xem danh sách & chi tiết báo cáo* là action trong use case này.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang Tour bị báo cáo, Chi tiết báo cáo của tour, Hộp thoại Ẩn/Khôi phục tour.
