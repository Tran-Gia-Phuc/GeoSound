# UC11 – Vẽ route và cấu hình kích hoạt audio

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC11 |
| **Use Case Name** | Vẽ route và cấu hình kích hoạt audio |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung vẽ đường route nối các điểm, đặt vùng kích hoạt (tròn/đa giác, chỉnh bán kính) cho từng điểm, đặt độ ưu tiên khi vùng chồng nhau, thêm audio chỉ đường với vùng riêng và gợi ý "đi tiếp đến đâu", để audio phát đúng lúc và khách không đi lạc. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở tab **"Route & kích hoạt"** trong trình chỉnh sửa tour. | |
| 2 | | Hệ thống hiển thị bản đồ với các điểm đã thêm (từ UC10). |
| 3 | Contributor vẽ đường route nối các điểm theo thứ tự. *A1* | |
| 4 | Contributor đặt **vùng kích hoạt** cho mỗi điểm (tròn hoặc đa giác, chỉnh bán kính/đỉnh). *E1* | |
| 5 | Contributor đặt **độ ưu tiên** cho các điểm có vùng kích hoạt chồng nhau. *A2* | |
| 6 | Contributor (tùy chọn) thêm **audio chỉ đường** với vùng kích hoạt riêng tại ngã rẽ. *A3* | |
| 7 | Contributor (tùy chọn) thêm gợi ý **"đi tiếp đến đâu"** phát sau khi nghe xong mỗi điểm. | |
| 8 | Contributor lưu cấu hình. | |
| 9 | | Hệ thống lưu route, vùng kích hoạt, độ ưu tiên và audio chỉ đường/gợi ý. |
| 10 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Điều chỉnh route** → hệ thống cập nhật lại route.

**A2. Điều chỉnh độ ưu tiên** → hệ thống lưu ưu tiên mới (áp dụng khi tourist đi tour – UC04).

**A3. Thêm/sửa/xóa audio chỉ đường** → hệ thống cập nhật audio chỉ đường tương ứng.

## Exception Path

- **E1.** Vùng kích hoạt không hợp lệ (bán kính 0, đa giác chưa khép kín) → báo lỗi, yêu cầu chỉnh.

## Extension Points

- UC12 – Cấu hình đa ngôn ngữ & TTS; UC13 – Xem thử tour.

## Triggers

Contributor cần thiết lập cách audio tự phát theo vị trí cho tour.

## Assumptions

- Tour đã có các điểm dừng với tọa độ hợp lệ.

## Preconditions

- Tour có ít nhất 2 điểm (UC10); contributor đã đăng nhập.

## Post Conditions

- Route, vùng kích hoạt, độ ưu tiên và audio chỉ đường/gợi ý được lưu — sẵn sàng cho trải nghiệm tự phát audio của tourist (UC04).

## Reference: Business Rules

- Vùng kích hoạt dạng **tròn hoặc đa giác**, do tác giả tự đặt và chỉnh bán kính.
- Khi các vùng chồng nhau, hệ thống (lúc chạy UC04) phát audio theo **độ ưu tiên do tác giả đặt**.
- *Vẽ route, đặt vùng, đặt ưu tiên, thêm audio chỉ đường* là các action trong use case này (C10–C14).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Tab "Route & kích hoạt", Công cụ vẽ route, Công cụ vẽ vùng kích hoạt, Bảng độ ưu tiên.
