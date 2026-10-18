# UC04 – Nghe tour (tại chỗ theo GPS / nghe thử từ xa)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC04 |
| **Use Case Name** | Nghe tour (tại chỗ theo GPS / nghe thử từ xa) |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch nghe nội dung tour theo hai chế độ: (1) đi thực địa — hệ thống theo GPS tự phát audio khi vào vùng kích hoạt; (2) nghe thử từ xa — chọn điểm thủ công không cần GPS. Hỗ trợ điều khiển phát, hiển thị text/ảnh và chạy đầy đủ khi offline. |

## Basic Course of Events *(Đi tour theo GPS)*

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist mở tour và nhấn **"Bắt đầu tour"** (muốn xem trước khi đến nơi → *A5 Nghe thử từ xa*). | |
| 2 | | Hệ thống kiểm tra quyền GPS và dữ liệu tour (text, ảnh, audio, route, vùng kích hoạt). *E1, E2* |
| 3 | | Hệ thống hiển thị bản đồ: vị trí GPS, các điểm dừng và route. |
| 4 | Tourist di chuyển theo route ngoài thực địa. | |
| 5 | | Hệ thống liên tục cập nhật vị trí GPS. |
| 6 | Tourist vào **vùng kích hoạt** của một điểm. | |
| 7 | | Hệ thống **tự động phát audio** điểm: ưu tiên người thật đúng ngôn ngữ, nếu không → **TTS** đã cache. *A1, A2, E3* |
| 8 | | Hệ thống hiển thị text và ảnh của điểm. |
| 9 | Tourist vào **vùng chỉ đường** ở ngã rẽ. | |
| 10 | | Hệ thống tự phát audio chỉ đường. |
| 11 | | Sau khi nghe xong điểm, hệ thống phát gợi ý **"đi tiếp đến đâu"** (nếu tác giả có cấu hình). |
| 12 | Tourist điều khiển audio: phát/tạm dừng, tua, chuyển điểm trước/sau. *A3* | |
| 13 | Tourist tiếp tục đến điểm cuối. *A4* | |
| 14 | | Khi hoàn thành, hệ thống thông báo kết thúc và gợi ý đánh giá (**UC05**). |
| 15 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Nhiều vùng kích hoạt chồng nhau** → hệ thống phát audio của điểm có **độ ưu tiên cao nhất** (theo cấu hình tác giả), quay về bước 8.

**A2. Đang phát điểm này thì vào vùng điểm khác** → hệ thống so độ ưu tiên: cao hơn thì chuyển phát ngay, thấp hơn thì chờ phát xong, quay về bước 7.

**A3. Chọn điểm thủ công** → tourist chọn điểm trên bản đồ/danh sách, hệ thống phát audio điểm đó không cần đến vùng kích hoạt, quay về bước 8.

**A4. Tạm rời và quay lại** → hệ thống lưu tiến độ; khi quay lại tiếp tục từ vị trí hiện tại, quay về bước 5.

**A5. Nghe thử từ xa (không cần GPS).**

| # | Actor Action | System Response |
|---|---|---|
| A5.1 | Tourist chọn **"Nghe thử từ xa"** (từ chi tiết tour – UC02). | |
| A5.2 | | Hệ thống mở chế độ nghe thủ công: danh sách điểm + trình phát audio, không dùng GPS. |
| A5.3 | Tourist chọn một điểm. | |
| A5.4 | | Hệ thống phát audio điểm (người thật/TTS) và hiển thị text/ảnh. |
| A5.5 | Tourist chuyển điểm trước/sau, đổi ngôn ngữ. Kết thúc chế độ nghe thử. | |

## Exception Path

- **E1.** Chưa cấp quyền GPS → yêu cầu cấp quyền; từ chối → gợi ý **nghe thử từ xa (A5)**.
- **E2.** GPS yếu/không ổn định → cảnh báo độ chính xác thấp, cho chọn điểm thủ công.
- **E3.** Thiếu/hỏng file audio → fallback phát **TTS** từ text; vẫn lỗi → hiển thị text kèm thông báo.
- **E4.** Mất mạng: tour **đã tải** chạy đầy đủ (GPS + audio offline); **chưa tải** → thông báo cần tải tour hoặc có kết nối.

## Extension Points

- UC02 – Tìm & xem tour (chọn ngôn ngữ, nghe thử từ xa); UC05 – Đánh giá & nhận xét tour (từ bước 14).

## Triggers

Tourist bắt đầu đi tour tại hiện trường, hoặc muốn nghe thử trước khi đến.

## Assumptions

- Thiết bị có GPS, còn pin; đã cấp quyền vị trí (với chế độ đi tour).

## Preconditions

- Tour đã mở hoặc đã tải (UC03); ngôn ngữ đã chọn (UC02); vùng kích hoạt đã cấu hình (UC11).

## Post Conditions

- Tourist đã nghe nội dung các điểm; tiến độ được lưu; có thể đánh giá.

## Reference: Business Rules

- Khi phát: **ưu tiên audio người thật** đúng ngôn ngữ; không có → **TTS**.
- Audio TTS **pre-render & cache khi tải** (UC03) để chạy offline.
- Vùng kích hoạt chồng nhau → phát theo **độ ưu tiên tác giả đặt**.
- Tour đã tải **hoạt động đầy đủ offline**.
- Chế độ **nghe thử từ xa không cần GPS** (phần còn lại của chế độ museum). Điều khiển phát/tua/chuyển điểm là action.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Bản đồ tour (GPS + điểm + route), Trình phát audio, Màn hình nội dung điểm (text + ảnh), Chế độ Nghe thử (danh sách điểm), Thông báo kết thúc tour.
