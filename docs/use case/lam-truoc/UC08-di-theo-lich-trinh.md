# UC08 – Đi theo lịch trình cá nhân

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC08 |
| **Use Case Name** | Đi theo lịch trình cá nhân |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P2 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch đi theo lịch trình cá nhân của mình và nghe audio tự phát khi đến gần từng điểm, giống như đi một tour thường. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist mở một lịch trình và nhấn **"Bắt đầu"**. | |
| 2 | | Hệ thống hiển thị bản đồ với vị trí GPS và các điểm trong lịch trình theo thứ tự. *E1* |
| 3 | Tourist di chuyển ngoài thực địa. | |
| 4 | | Hệ thống cập nhật GPS và tự phát audio điểm khi tourist đến gần (ưu tiên người thật, nếu không → TTS). *A1* |
| 5 | Tourist điều khiển phát và chuyển điểm. | |
| 6 | | Khi hoàn thành các điểm, hệ thống hiển thị thông báo kết thúc. |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Chọn điểm thủ công.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Tourist chọn một điểm trong lịch trình. | |
| A1.2 | | Hệ thống phát audio điểm đó mà không cần đến gần. |

## Exception Path

- **E1.** Chưa cấp GPS hoặc tín hiệu yếu → cảnh báo và cho nghe thủ công (tương tự UC04).

## Extension Points

- UC07 – Tạo & quản lý lịch trình cá nhân.

## Triggers

Tourist bắt đầu đi theo lịch trình đã lập.

## Assumptions

- Thiết bị có GPS; lịch trình đã được tạo (UC07).

## Preconditions

- Tourist đã có lịch trình cá nhân (đã tải nếu đi offline).

## Post Conditions

- Tourist đã đi và nghe audio theo lịch trình của mình.

## Reference: Business Rules

- Trải nghiệm tương tự **UC04** nhưng nguồn điểm là **lịch trình cá nhân**.
- Hoạt động offline nếu lịch trình đã tải; audio ưu tiên người thật → TTS.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Bản đồ lịch trình (GPS + điểm), Trình phát audio.
