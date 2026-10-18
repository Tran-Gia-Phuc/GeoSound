# UC17 – Xem thống kê và đánh giá tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC17 |
| **Use Case Name** | Xem thống kê và đánh giá tour |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P1 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung xem thống kê (lượt tải, lượt nghe, điểm đánh giá, nhận xét) của tour để biết hiệu quả và cải thiện nội dung. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor chọn **"Thống kê"** của một tour. | |
| 2 | | Hệ thống hiển thị số liệu: lượt xem, lượt tải, lượt nghe/hoàn thành, điểm đánh giá trung bình, phân bố sao và danh sách nhận xét. *E1* |
| 3 | Contributor lọc theo thời gian hoặc ngôn ngữ. *A1* | |
| 4 | Contributor đọc nhận xét để biết điểm cần cải thiện. | |
| 5 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Lọc theo khoảng thời gian / ngôn ngữ** → hệ thống hiển thị lại số liệu theo bộ lọc.

## Exception Path

- **E1.** Tour mới công khai chưa có dữ liệu → hiển thị *"Chưa có dữ liệu thống kê"*.

## Extension Points

- UC05 – Đánh giá & nhận xét tour (nguồn đánh giá); UC10 / UC11 – chỉnh sửa nội dung.

## Triggers

Contributor muốn đánh giá hiệu quả và cải thiện tour.

## Assumptions

- Tour đã công khai và có người dùng tương tác.

## Preconditions

- Contributor đã đăng nhập; tour thuộc về contributor.

## Post Conditions

- Contributor nắm được số liệu và phản hồi của tour.

## Reference: Business Rules

- Thống kê dựa trên hành vi tourist (tải/nghe) và đánh giá (UC05).
- Contributor chỉ xem được thống kê các tour của **chính mình**.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Thống kê tour (biểu đồ + danh sách nhận xét), Bộ lọc thời gian/ngôn ngữ.
