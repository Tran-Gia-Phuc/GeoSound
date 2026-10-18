# UC10 – Thêm và quản lý địa điểm trên tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC10 |
| **Use Case Name** | Thêm và quản lý địa điểm trên tour |
| **Actor(s)** | Người đăng nội dung (Contributor) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Người đăng nội dung thêm các điểm dừng lên bản đồ (tìm địa chỉ hoặc thả pin), gắn nội dung bắt buộc (tên, loại, mô tả text, ảnh có chú thích) và audio tùy chọn (người thật hoặc TTS), đồng thời sắp xếp/sửa/xóa điểm để tạo nội dung tour. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở trình chỉnh sửa tour và chọn **"Thêm điểm"**. | |
| 2 | | Hệ thống hiển thị bản đồ với hai cách thêm: tìm theo địa chỉ hoặc thả pin thủ công. |
| 3 | Contributor tìm địa chỉ để định vị điểm. *A1, E1* | |
| 4 | | (Khi đặt điểm) Hệ thống kiểm tra vị trí so với danh sách vùng cấm. *E2* |
| 5 | | Hệ thống mở form nội dung điểm: tên, loại địa điểm, **mô tả text (bắt buộc)**, nhiều ảnh có chú thích, audio người thật (tùy chọn). |
| 6 | Contributor nhập nội dung và upload ảnh. *E3* | |
| 7 | | (Khi upload ảnh) Hệ thống tự quét NSFW tại trình duyệt. *E4* |
| 8 | Contributor (tùy chọn) upload file audio người thật cho điểm. | |
| 9 | | Nếu không có audio người thật, hệ thống dùng **TTS** đọc text làm audio cho điểm. |
| 10 | Contributor lưu điểm. | |
| 11 | | Hệ thống lưu điểm và hiển thị trên bản đồ + danh sách điểm. |
| 12 | Contributor lặp lại để thêm nhiều điểm; sắp xếp/sửa/xóa điểm. *A2, A3* | |
| 13 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Thả pin thủ công** → hệ thống ghi tọa độ, tiếp tục ở bước 4.

**A2. Sắp xếp lại thứ tự điểm** → hệ thống cập nhật thứ tự.

**A3. Sửa / Xóa điểm** → hệ thống cập nhật hoặc xóa điểm khỏi tour.

## Exception Path

- **E1.** Không tìm thấy địa chỉ → gợi ý thả pin thủ công (A1).
- **E2.** Điểm nằm trong **vùng cấm** (quân sự, trường học, bệnh viện, lãnh sự quán) → cảnh báo, yêu cầu điều chỉnh vị trí.
- **E3.** Thiếu **text mô tả (bắt buộc)** → chặn lưu và yêu cầu nhập.
- **E4.** Ảnh vi phạm NSFW → **từ chối upload** ảnh đó.

## Extension Points

- UC11 – Vẽ route & cấu hình kích hoạt audio; UC12 – Cấu hình đa ngôn ngữ & TTS.

## Triggers

Contributor cần tạo nội dung các điểm dừng cho tour.

## Assumptions

- Dịch vụ bản đồ/geocoding khả dụng.

## Preconditions

- Tour đã được tạo (UC09), đang ở Nháp; contributor đã đăng nhập.

## Post Conditions

- Các điểm dừng (text bắt buộc, ảnh, audio người thật hoặc TTS) được lưu vào tour.

## Reference: Business Rules

- **Text mô tả bắt buộc** cho mỗi điểm — nguồn nội dung chính, dùng cho kiểm duyệt AI và hiển thị cùng audio.
- **Audio người thật tùy chọn** (mỗi điểm một file cho ngôn ngữ gốc); không có → dùng TTS.
- Ảnh quét NSFW client-side; vị trí điểm kiểm vùng cấm bằng turf.js.
- *Tìm địa chỉ, thả pin, nhập nội dung, sắp xếp/xóa* là các action trong use case này (C6–C9, C19, C20).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trình chỉnh sửa tour, Bản đồ thêm điểm (tìm địa chỉ/thả pin), Form nội dung điểm, Danh sách điểm.
