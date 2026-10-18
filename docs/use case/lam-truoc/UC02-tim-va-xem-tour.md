# UC02 – Tìm và xem tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC02 |
| **Use Case Name** | Tìm và xem tour |
| **Actor(s)** | Khách du lịch (Tourist) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Khách du lịch tìm tour theo thành phố/từ khóa và xem chi tiết tour (ảnh, mô tả, route trên bản đồ, đánh giá, nhãn giọng, chọn ngôn ngữ) để quyết định tải hay đi tour. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist chọn chức năng **"Tìm tour"**. | |
| 2 | | Hệ thống hiển thị ô tìm kiếm, bộ lọc (thành phố, ngôn ngữ, loại) và danh sách tour phổ biến/gợi ý. |
| 3 | Tourist nhập từ khóa/chọn thành phố/áp bộ lọc. *A1* | |
| 4 | Tourist nhấn **"Tìm"**. | |
| 5 | | Hệ thống hiển thị danh sách tour **công khai (đã duyệt)** khớp: ảnh bìa, tên, số điểm, thời lượng, điểm đánh giá, nhãn "giọng người thật / giọng máy (TTS)". *E1, E2* |
| 6 | Tourist chọn một tour. | |
| 7 | | Hệ thống hiển thị chi tiết tour: ảnh bìa, mô tả, số điểm dừng, thời lượng, route trên bản đồ, điểm đánh giá trung bình, nhãn giọng, và phần đánh giá/nhận xét. *E3* |
| 8 | Tourist chọn **ngôn ngữ** nghe. *A2* | |
| 9 | | Hệ thống cập nhật nhãn giọng theo ngôn ngữ (có audio người thật đúng ngôn ngữ → "giọng người thật"; nếu không → "giọng máy (TTS)"). |
| 10 | Tourist chọn hành động: Tải tour / Nghe thử từ xa / Bắt đầu (nếu đã tải). *A3* | |
| 11 | | Hệ thống chuyển sang use case tương ứng (UC03 Tải / UC04 Nghe tour). |
| 12 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Sắp xếp / lọc nâng cao.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Tourist chọn tiêu chí sắp xếp (phổ biến, đánh giá cao, gần tôi) hoặc lọc nâng cao. | |
| A1.2 | | Hệ thống sắp xếp/lọc lại danh sách, quay về bước 5. |

**A2. Đổi ngôn ngữ nghe.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Tourist chọn ngôn ngữ khác. | |
| A2.2 | | Hệ thống cập nhật nhãn giọng và nội dung tương ứng, quay về bước 9. |

**A3. Báo cáo tour.**

| # | Actor Action | System Response |
|---|---|---|
| A3.1 | Tourist chọn "Báo cáo" trên trang chi tiết. | |
| A3.2 | | Hệ thống chuyển sang **UC06 – Báo cáo tour vi phạm**. |

## Exception Path

- **E1.** Không có tour khớp → thông báo *"Không tìm thấy tour phù hợp"* và gợi ý tour phổ biến.
- **E2.** Mất mạng khi tìm online → thông báo, cho **Thử lại** hoặc xem **tour đã tải** (UC03).
- **E3.** Tour không còn khả dụng (đã ẩn/xóa) → thông báo và quay lại danh sách.

## Extension Points

- UC03 – Quản lý tour offline (tải); UC04 – Nghe tour; UC06 – Báo cáo tour vi phạm.

## Triggers

Tourist muốn tìm và tìm hiểu tour tại nơi mình đến.

## Assumptions

- Có kết nối internet để tìm/xem tour online (trừ tour đã tải).

## Preconditions

- App đã mở; có tour công khai trong hệ thống. Không bắt buộc đăng nhập.

## Post Conditions

- Tourist xem được chi tiết tour và ngôn ngữ nghe; có thể tải hoặc bắt đầu tour.

## Reference: Business Rules

- Chỉ tour **"Công khai (đã được Admin duyệt)"** mới hiển thị trong tìm kiếm công khai; tour Nháp/Truy cập hạn chế/Chờ duyệt/Đang bị ẩn **không** hiển thị.
- Nhãn giọng theo nguyên tắc **ưu tiên audio người thật**; không có → "giọng máy (TTS)".
- Ngôn ngữ chọn quyết định audio sẽ phát (người thật đúng ngôn ngữ → ưu tiên; nếu không → TTS).
- *Tìm kiếm, xem đánh giá, chọn ngôn ngữ* là các action trong cùng use case này (gộp từ T1 + T2/T3/T4/T24).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Tìm tour (ô tìm kiếm + bộ lọc), Danh sách kết quả, Màn hình Chi tiết tour (thông tin + bản đồ + đánh giá + chọn ngôn ngữ).
