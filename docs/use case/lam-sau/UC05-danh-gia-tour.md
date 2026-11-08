# UC05 – Đánh giá và nhận xét tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC05 |
| **Use Case Name** | Đánh giá và nhận xét tour |
| **Actor(s)** | Khách du lịch (Tourist, đã đăng nhập; mọi vai trò trừ tác giả của tour) |
| **Priority** | P0 |
| **Maturity** | Implemented |
| **Summary** | Người dùng đã đăng nhập chấm 1–5 sao và viết nhận xét (không bắt buộc) cho một tour công khai, có thể sửa hoặc xóa đánh giá của mình. Mọi người (kể cả khách chưa đăng nhập) xem được điểm trung bình, số lượt, phân bố sao và danh sách nhận xét. Dữ liệu này dùng cho thống kê UC17. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist mở mục **"Đánh giá"** trên chi tiết tour (`/tour/:tourId#ratings`), hoặc bấm nút đánh giá ở hộp thoại kết thúc của trình phát (UC04). | |
| 2 | | Client gọi `GET /api/tours/:id/ratings` (công khai) để hiện tóm tắt (điểm trung bình, số lượt, phân bố 1–5 sao) và danh sách nhận xét mới nhất trước, 10 mục mỗi trang. *E3* `listRatings()` → `ListTourRatings.execute()` |
| 3 | | Nếu đã đăng nhập, client gọi `GET /api/tours/:id/ratings/mine`: chưa có thì hiện form "Đánh giá tour", đã có thì hiện "Đánh giá của bạn". *E1, E4, A1* `getMyRating()` → `GetMyTourRating.execute()` |
| 4 | Tourist chọn số sao và nhập nhận xét (không bắt buộc, tối đa 1000 ký tự). *E2* | |
| 5 | Tourist nhấn **"Gửi đánh giá"**. | |
| 6 | | Client gọi `PUT /api/tours/:id/ratings/mine`. Tour lưu dòng `tour_ratings` và cập nhật `tours.average_rating`, `tours.rating_count` trong cùng một transaction, trả 201 kèm tóm tắt mới. `saveMyRating()` → `SaveMyTourRating.execute()` → `PrismaTourRatingRepository.saveForUser()` |
| 7 | | Client hiện thông báo *"Cảm ơn đánh giá của bạn"* và làm mới tóm tắt, danh sách. `RatingsSection` |
| 8 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Sửa đánh giá của mình.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | Tourist chọn Sửa trên "Đánh giá của bạn", đổi số sao hoặc nhận xét và nhấn **"Lưu thay đổi"**. | |
| A1.2 | | `PUT /api/tours/:id/ratings/mine` trả 200 (cập nhật, không tạo dòng mới); điểm trung bình được tính lại; thông báo *"Đã cập nhật đánh giá"*. Nhận xét đã sửa hiện nhãn "đã sửa". `SaveMyTourRating.execute()` |

**A2. Xóa đánh giá của mình.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Tourist chọn Xóa trên "Đánh giá của bạn". | |
| A2.2 | | `DELETE /api/tours/:id/ratings/mine` trả 204; số lượt và điểm trung bình được tính lại; thông báo *"Đã xoá đánh giá"*. `deleteMyRating()` → `DeleteMyTourRating.execute()` → `PrismaTourRatingRepository.deleteForUser()` |

**A3. Xem thêm nhận xét.** Tourist cuộn danh sách và tải trang tiếp theo (`page`, `limit` tối đa 50). `listRatings()` → `ListTourRatings.execute()` → `PrismaTourRatingRepository.listByTour()`

## Exception Path

- **E1.** Chưa đăng nhập → thay form là nút *"Đăng nhập để đánh giá"*, dẫn tới `/login?next=...#ratings` (UC01) rồi quay lại đúng mục đánh giá. API trả 401 nếu gọi không có token.
- **E2.** Gửi khi chưa chọn sao → *"Vui lòng chọn số sao"* (client chặn; server trả 400 `validation_error` cùng thông điệp). `saveRatingSchema`, `normalizeRatingInput()`
- **E3.** Tour không ở trạng thái `public` (hoặc không tồn tại) → 404 `tour_not_found`, giống chi tiết công khai.
- **E4.** Tác giả mở tour của chính mình → không có form, hiện *"Bạn là tác giả của tour này nên không thể tự đánh giá."*; API trả 403 `own_tour`.
- **E5.** Mất mạng → *"Không thể kết nối, vui lòng thử lại"*; xóa khi chưa có đánh giá → 404 `rating_not_found`.

## Extension Points

- UC01 – Xác thực tài khoản (đăng nhập để đánh giá).
- UC04 – Nghe tour (nút đánh giá ở hộp thoại kết thúc).
- UC17 – Thống kê tour (dùng điểm trung bình và phân bố sao).

## Triggers

Tourist đã xem hoặc nghe tour và muốn để lại đánh giá.

## Assumptions

- Không bắt buộc phải nghe hết tour trước khi đánh giá.
- Token đăng nhập có claim `name` (tên hiển thị) do Auth thêm; token cũ chưa có claim này thì tên hiện là "Người dùng GeoSound" đến lần đăng nhập hoặc làm mới token sau.

## Preconditions

- Tour tồn tại và có `status = 'public'`.
- Để gửi, sửa, xóa: Tourist đã đăng nhập (UC01) và không phải tác giả của tour.

## Post Conditions

- Có đúng một dòng `tour_ratings` cho mỗi cặp (tour, tài khoản), hoặc dòng đã bị xóa (A2).
- `tours.average_rating` và `tours.rating_count` luôn khớp với mọi thay đổi; `tours.updated_at` (revision cho kiểm duyệt và danh mục) không đổi.
- Không phát sự kiện nào.

## Reference: Business Rules

| # | Quy tắc |
|---|---|
| R1 | Đánh giá cần đăng nhập (mọi vai trò); đọc đánh giá là công khai |
| R2 | Mỗi tài khoản một đánh giá mỗi tour (khóa duy nhất `tour_id, user_id`); gửi lần hai là sửa |
| R3 | Số sao bắt buộc, số nguyên 1–5; nhận xét không bắt buộc, được cắt khoảng trắng, tối đa 1000 ký tự |
| R4 | Chỉ tour `public` được đánh giá và liệt kê đánh giá; trạng thái khác trả 404 |
| R5 | Tác giả không tự đánh giá tour của mình (403 `own_tour`) |
| R6 | Không đính kèm ảnh; nhận xét không gửi qua kiểm duyệt AI, nội dung xấu xử lý bằng báo cáo (UC06) |
| R7 | Điểm trung bình cập nhật nguyên tử bằng SQL thô trong cùng transaction với dòng đánh giá (khóa `SELECT ... FOR UPDATE`) |
| R8 | Nhận xét hiện tên hiển thị chụp tại lúc đánh giá (`user_name`), không bao giờ hiện email hay user id |
| R9 | Giá trị demo đã seed trong `average_rating` / `rating_count` được giữ làm điểm xuất phát; phân bố sao chỉ tính từ các dòng thật |

## Hiện thực trong hệ thống

- **Dịch vụ:**
  - Client: mục Đánh giá trên chi tiết tour, form, danh sách có phân trang.
  - Gateway: chuyển `/api/tours` sang Tour.
  - Tour: kiểm tra quy tắc, lưu đánh giá, cập nhật điểm trung bình.
  - Auth: thêm claim `name` vào access token (bổ sung, các dịch vụ khác bỏ qua).
- **Màn hình (client):** `/tour/:tourId` (mục `#ratings`, `client/src/features/tours/RatingsSection.jsx`); hộp thoại kết thúc của `/tour/:tourId/play` (`client/src/features/player/CompletionDialog.jsx`). API helper `client/src/lib/ratings.js`.
- **API (qua gateway):**
  - `GET /api/tours/:id/ratings?page=&limit=` (công khai)
  - `GET /api/tours/:id/ratings/mine`
  - `PUT /api/tours/:id/ratings/mine` (201 tạo / 200 sửa)
  - `DELETE /api/tours/:id/ratings/mine` (204)
- **Sự kiện (RabbitMQ):** không có. Đánh giá không đưa vào chỉ mục chatbot.
- **Dữ liệu:** `tour.tour_ratings` (`tour_id`, `user_id`, `user_name`, `stars`, `comment`, `created_at`, `updated_at`); `tour.tours.average_rating`, `tour.tours.rating_count`.
- **Mã nguồn chính:**

| Bước | Hàm / lớp | File |
|---|---|---|
| 1–7 | `RatingsSection` | `client/src/features/tours/RatingsSection.jsx` |
| 1 (từ trình phát) | `CompletionDialog` | `client/src/features/player/CompletionDialog.jsx` |
| 2, A3 | `listRatings()` | `client/src/lib/ratings.js` |
| 3 | `getMyRating()` | `client/src/lib/ratings.js` |
| 6, A1 | `saveMyRating()` | `client/src/lib/ratings.js` |
| A2 | `deleteMyRating()` | `client/src/lib/ratings.js` |
| Route | `buildTourRatingRouter()` | `services/tour/src/interfaces/http/routes/tour-rating-routes.js` |
| Controller | `TourRatingController` (`list`, `mine`, `save`, `remove`) | `services/tour/src/interfaces/http/controllers/tour-rating-controller.js` |
| E2 | `saveRatingSchema`, `ratingListQuerySchema` | `services/tour/src/application/dtos/rating-schemas.js` |
| 2 | `ListTourRatings.execute()` | `services/tour/src/application/use-cases/tour-ratings.js` |
| 3 | `GetMyTourRating.execute()` | `services/tour/src/application/use-cases/tour-ratings.js` |
| 6, A1 | `SaveMyTourRating.execute()` | `services/tour/src/application/use-cases/tour-ratings.js` |
| A2 | `DeleteMyTourRating.execute()` | `services/tour/src/application/use-cases/tour-ratings.js` |
| R3, R8 | `normalizeRatingInput()`, `reviewerName()`, `ratingDelta` | `services/tour/src/domain/entities/tour-rating.js` |
| 6, A2, A3 | `PrismaTourRatingRepository` (`saveForUser`, `deleteForUser`, `listByTour`, `distribution`) | `services/tour/src/infrastructure/persistence/prisma-tour-rating-repository.js` |
| Claim `name` | `User.toAuthPayload()` | `services/auth/src/domain/entities/user.js` |

- **Tài liệu thiết kế:** [uc05-ratings.md](../../02-design/uc05-ratings.md).

## Author(s)

(điền sau)

## Date

Tạo: 2026-10-18 · Cập nhật theo hệ thống: 2026-11-08

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

```mermaid
sequenceDiagram
    actor U as Tourist
    participant C as Client
    participant G as Gateway
    participant T as Tour
    U->>C: Mở mục Đánh giá
    C->>G: GET /api/tours/:id/ratings
    G->>T: GET /tours/:id/ratings
    T-->>C: summary + items
    C->>G: GET /api/tours/:id/ratings/mine (JWT)
    G->>T: chuyển tiếp
    T-->>C: { rating: null }
    U->>C: Chọn sao, nhập nhận xét, Gửi
    C->>G: PUT /api/tours/:id/ratings/mine { stars, comment }
    G->>T: chuyển tiếp
    T->>T: Kiểm tra public, không phải tác giả; lưu tour_ratings + cập nhật average_rating (1 transaction)
    T-->>C: 201 { rating, summary }
    C-->>U: "Cảm ơn đánh giá của bạn"
```

## Boundary

- Chi tiết tour `/tour/:tourId`, mục **Đánh giá** (`#ratings`): tóm tắt sao, form "Đánh giá tour" / "Đánh giá của bạn", danh sách nhận xét.
- Hộp thoại kết thúc của trình phát `/tour/:tourId/play` (nút dẫn tới `/tour/:tourId#ratings`).
- Đăng nhập `/login` (khi chưa đăng nhập).
