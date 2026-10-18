# UC06 – Báo cáo tour vi phạm

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC06 |
| **Use Case Name** | Báo cáo tour vi phạm |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch báo cáo tour có nội dung sai lệch, phản cảm hoặc spam bằng cách chọn lý do từ danh sách, để giúp cộng đồng được bảo vệ (Tầng 3 – Community report). |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist (từ chi tiết tour UC02 hoặc trong khi nghe) chọn **"Báo cáo"**. | |
| 2 | | Hệ thống hiển thị form với danh sách lý do: *sai sự thật / phản cảm / spam / vi phạm bản quyền / khác* (kèm ô ghi chú). *E1* |
| 3 | Tourist chọn lý do (nhập mô tả nếu "khác"). *E2* | |
| 4 | Tourist nhấn **"Gửi báo cáo"**. | |
| 5 | | Hệ thống lưu báo cáo (người báo cáo, lý do, thời gian) và tăng bộ đếm report của tour. |
| 6 | | Hệ thống kiểm tra ngưỡng tự động. *A1* |
| 7 | | Hệ thống thông báo *"Đã gửi báo cáo, cảm ơn bạn"*. |
| 8 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Tour đạt ngưỡng báo cáo tự động.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | | Nếu tour nhận **≥ 5 báo cáo khác nhau trong 7 ngày**, hệ thống tự chuyển tour sang **"Chờ Admin xem lại"** (không ẩn hẳn) để Admin xử lý (UC20). |

## Exception Path

- **E1.** Chưa đăng nhập (nếu yêu cầu) → gợi ý đăng nhập (UC01) để chống spam báo cáo.
- **E2.** Chưa chọn lý do → thông báo *"Vui lòng chọn lý do báo cáo"*.

## Extension Points

- UC01 – Xác thực tài khoản; UC20 – Xử lý báo cáo & vi phạm tour.

## Triggers

Tourist phát hiện tour có nội dung không phù hợp.

## Assumptions

- Tour đang ở trạng thái công khai.

## Preconditions

- Tour tồn tại và công khai.

## Post Conditions

- Báo cáo được ghi nhận; nếu đạt ngưỡng, tour chuyển sang "Chờ Admin xem lại".

## Reference: Business Rules

- **Tầng 3 – Community report** trong mô hình kiểm duyệt 3 tầng.
- Tour nhận **≥ 5 báo cáo khác nhau trong 7 ngày** → tự chuyển **"Chờ Admin xem lại"** (không ẩn hẳn, tránh report bomb — Admin có thể khôi phục).
- Mỗi tài khoản chỉ báo cáo một lần cho mỗi tour.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Nút "Báo cáo" (chi tiết tour / trình phát), Form chọn lý do báo cáo.
