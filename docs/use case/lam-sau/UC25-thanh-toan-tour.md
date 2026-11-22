# UC25 – Thanh toán tour trả phí

> **Trạng thái: đề xuất, chưa triển khai.** Use case này mô tả thiết kế cho chức năng thanh toán (mục "Future considerations" của PRD). Hệ thống hiện tại chưa có mã nguồn, bảng dữ liệu hay API thanh toán; mọi tour đang miễn phí. Mục "Thiết kế đề xuất" thay cho mục "Hiện thực trong hệ thống" của các UC khác.

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC25 |
| **Use Case Name** | Thanh toán tour trả phí |
| **Actor(s)** | Khách du lịch (Tourist, đã đăng nhập); cổng thanh toán VNPay (hệ thống bên ngoài) |
| **Priority** | P3 |
| **Maturity** | Proposed (chưa triển khai) |
| **Summary** | Tác giả đặt giá cho tour (UC09). Tourist mở một tour có giá, nhấn "Mua tour", được chuyển sang VNPay để thanh toán. Khi VNPay báo giao dịch thành công (IPN có chữ ký hợp lệ, đúng số tiền), hệ thống ghi nhận đơn hàng đã thanh toán và cấp quyền nghe, tải offline tour đó vĩnh viễn cho tài khoản; Tourist nhận email biên nhận. Tour miễn phí (giá 0) không đi qua use case này. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist mở chi tiết một tour công khai có giá (`/tour/:tourId`). *A1* | |
| 2 | | Hệ thống hiển thị giá (ví dụ *"49.000 ₫"*), phần nghe thử điểm đầu tiên và nút **"Mua tour"** thay cho nút "Bắt đầu nghe". *A2* |
| 3 | Tourist nhấn **"Mua tour"**. *E1* | |
| 4 | | Hệ thống hiện hộp thoại *"Xác nhận mua tour"* với tên tour, giá và phương thức *"Thanh toán qua VNPay (ATM, thẻ quốc tế, QR)"*. |
| 5 | Tourist nhấn **"Thanh toán"**. | |
| 6 | | Hệ thống (Payment) kiểm tra tour còn công khai, giá không đổi, Tourist chưa mua tour này và không phải tác giả; tạo đơn hàng `pending` (hết hạn sau 15 phút) và trả URL thanh toán VNPay đã ký. *E2, E3, E4* |
| 7 | | Client chuyển Tourist sang trang VNPay. |
| 8 | Tourist thanh toán trên trang VNPay. *A3, E5* | |
| 9 | | VNPay gọi IPN về Payment. Hệ thống kiểm tra chữ ký HMAC-SHA512, mã đơn, số tiền và trạng thái đơn; đánh dấu đơn `paid` và phát sự kiện `payment.completed`; Tour nhận sự kiện và ghi quyền truy cập tour cho Tourist. *E6, E7* |
| 10 | | VNPay chuyển Tourist về `/payment/result`; client hỏi trạng thái đơn và hiện *"Thanh toán thành công. Bạn đã có thể nghe tour này."* với nút **"Bắt đầu nghe"** (UC04). *E8* |
| 11 | | Notification nhận `payment.completed`, lưu thông báo trong app (UC16) và gửi email biên nhận (mã đơn, tên tour, số tiền, thời gian). |
| 12 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Tour đã mua hoặc Tourist là tác giả / Admin.**

| # | Actor Action | System Response |
|---|---|---|
| A1.1 | | Hệ thống hiện nhãn *"Đã mua"* (hoặc không hiện giá với tác giả và Admin) và nút "Bắt đầu nghe" như tour miễn phí; use case kết thúc. |

**A2. Xem lịch sử mua.**

| # | Actor Action | System Response |
|---|---|---|
| A2.1 | Tourist mở Tài khoản → **"Tour đã mua"**. | |
| A2.2 | | Hệ thống liệt kê các đơn `paid` (tên tour, số tiền, ngày mua, mã đơn) với nút mở tour; danh sách trống hiện *"Bạn chưa mua tour nào"*. |

**A3. Tourist hủy thanh toán trên VNPay.**

| # | Actor Action | System Response |
|---|---|---|
| A3.1 | Tourist nhấn "Hủy giao dịch" trên trang VNPay. | |
| A3.2 | | IPN báo mã hủy (`24`); đơn chuyển sang `cancelled`. Trang kết quả hiện *"Bạn đã hủy thanh toán."* với nút **"Thử lại"** (quay về bước 3). |

## Exception Path

- **E1.** Chưa đăng nhập → hộp thoại *"Bạn cần đăng nhập để mua tour."* với nút "Đăng nhập" (UC01); API trả 401.
- **E2.** Tour không còn công khai hoặc không tồn tại → 404 *"Tour không còn khả dụng"*; giá đã đổi so với lúc mở trang → 409 *"Giá tour đã thay đổi, vui lòng xem lại"* và client tải lại giá.
- **E3.** Đã mua tour này → 409 *"Bạn đã mua tour này"*, client chuyển sang trạng thái A1. Đang có đơn `pending` chưa hết hạn → hệ thống trả lại URL của đơn đó, không tạo đơn mới.
- **E4.** Tourist là tác giả → 403 *"Bạn không cần mua tour của chính mình"*.
- **E5.** Thanh toán thất bại trên VNPay (thẻ bị từ chối, không đủ số dư, sai OTP) → đơn `failed`, trang kết quả hiện *"Thanh toán không thành công"* kèm lý do từ VNPay và nút "Thử lại".
- **E6.** IPN sai chữ ký → trả `RspCode 97`, không đổi đơn, ghi log cảnh báo; sai số tiền → `RspCode 04`, đơn chuyển `failed` để Admin kiểm tra; mã đơn không tồn tại → `RspCode 01`.
- **E7.** IPN gửi lại cho đơn đã `paid` → trả `RspCode 02` (đã xác nhận), không cấp quyền hay gửi email lần nữa.
- **E8.** Tourist về trang kết quả trước khi có IPN → client hiện *"Đang xác nhận thanh toán…"* và hỏi lại trạng thái mỗi 3 giây trong 1 phút; quá hạn hiện *"Chưa nhận được xác nhận. Kết quả sẽ có trong Thông báo."* Đơn `pending` quá 15 phút chuyển `expired`.

## Extension Points

- UC01 – Xác thực tài khoản.
- UC02 – Tìm và xem tour (hiển thị giá, nhãn "Đã mua").
- UC03 – Quản lý tour offline (chỉ tải được tour đã mua).
- UC04 – Nghe tour.
- UC09 – Quản lý tour của mình (tác giả đặt giá).
- UC16 – Thông báo trong ứng dụng và email.
- UC17 – Thống kê tour (thêm số lượt mua, doanh thu).

## Triggers

Tourist muốn nghe trọn một tour có giá.

## Assumptions

- Dùng VNPay (môi trường sandbox khi demo); mọi giá tính bằng VND.
- Chia doanh thu với tác giả và hoàn tiền nằm ngoài phạm vi: Admin xử lý thủ công trên cổng quản trị VNPay.

## Preconditions

- Tour ở trạng thái `public` và có giá lớn hơn 0.
- Tourist đã đăng nhập (UC01), không phải tác giả và chưa mua tour này.

## Post Conditions

- Thành công: một dòng `payment.orders` với `status = paid` và một dòng `tour.tour_purchases`; Tourist nghe, tải offline tour mọi lúc, kể cả khi tác giả đổi giá sau đó.
- Không thành công: đơn ở `cancelled`, `failed` hoặc `expired`; không có quyền truy cập nào được cấp.

## Reference: Business Rules

| # | Quy tắc |
|---|---|
| R1 | Giá là số nguyên VND: 0 (miễn phí) hoặc từ 10.000 đến 2.000.000; tác giả đổi giá ở UC09, giá mới chỉ áp cho đơn tạo sau đó |
| R2 | Mỗi tài khoản mua một tour một lần (khóa duy nhất `tour_id, user_id` trên `tour_purchases`); quyền truy cập không hết hạn |
| R3 | Tác giả và Admin nghe miễn phí; tour truy cập hạn chế (UC14) không bán |
| R4 | Chỉ IPN có chữ ký HMAC-SHA512 hợp lệ (khóa bí mật `VNPAY_HASH_SECRET`) và đúng số tiền mới đánh dấu đơn `paid`; trang kết quả (return URL) chỉ để hiển thị, không bao giờ cấp quyền |
| R5 | Xử lý IPN idempotent: đơn đã `paid` không cấp quyền hay gửi email lần hai |
| R6 | Payment lưu đơn `paid` và sự kiện `payment.completed` cần phát trong một transaction (outbox), rồi phát lại tới khi broker nhận; Tour ghi `tour_purchases` idempotent theo `order_id` |
| R7 | Đơn `pending` hết hạn sau 15 phút; trạng thái đơn: `pending`, `paid`, `failed`, `cancelled`, `expired` |
| R8 | Không lưu số thẻ hay thông tin thanh toán của Tourist; chỉ lưu mã giao dịch VNPay, ngân hàng và mã phản hồi |
| R9 | Không có quyền mua → nghe thử được điểm đầu tiên; các điểm khác, gói offline và route bị khóa (403 `purchase_required`) |

## Thiết kế đề xuất

- **Dịch vụ:**
  - Client: giá và nút "Mua tour" ở chi tiết tour, hộp thoại xác nhận, trang `/payment/result`, mục "Tour đã mua" ở Tài khoản.
  - Gateway: chuyển `/api/payments` sang Payment; `/api/payments/vnpay/ipn` không cần JWT.
  - Payment (dịch vụ mới, schema `payment`): tạo đơn, ký URL VNPay, xác minh IPN, phát `payment.completed`.
  - Tour: lưu giá tour, nhận `payment.completed` để ghi `tour_purchases`, kiểm tra quyền mua khi trả nội dung tour, gói offline và audio.
  - Notification: thông báo trong app và email biên nhận.
- **API (qua gateway):**
  - `POST /api/payments/orders` `{ tourId, expectedPrice }` → 201 `{ orderId, paymentUrl, expiresAt }`
  - `GET /api/payments/orders/:id` → `{ status, amount, tourId, paidAt? }`
  - `GET /api/payments/orders?status=paid` → lịch sử mua (A2)
  - `GET /api/payments/vnpay/ipn` (VNPay gọi) → `{ RspCode, Message }`
- **Sự kiện (RabbitMQ):** Payment phát `payment.completed` `{ orderId, userId, tourId, amount, paidAt, email? }`; Tour và Notification tiêu thụ.
- **Dữ liệu:**
  - `payment.orders` (`id`, `user_id`, `tour_id`, `amount`, `status`, `vnp_txn_ref`, `vnp_transaction_no`, `bank_code`, `response_code`, `expires_at`, `paid_at`, `created_at`)
  - `tour.tour_purchases` (`tour_id`, `user_id`, `order_id`, `amount`, `created_at`)
  - `tour.tours.price` (số nguyên, mặc định 0)
- **Cấu hình:** `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_URL`, `VNPAY_RETURN_URL` (bí mật, chỉ trong `.env`).

## Author(s)

(điền sau)

## Date

Tạo: 2026-11-22 (đề xuất)

## Activity Diagram

[UC25-activity.xml](../../02-design/drawio/activity/UC25-activity.xml) (draw.io: File → Import from → Device). Nguồn: [specs/UC25.json](../../02-design/drawio/activity/specs/UC25.json).

## Sequence Diagram

```mermaid
sequenceDiagram
    actor U as Tourist
    participant C as Client
    participant G as Gateway
    participant P as Payment
    participant V as VNPay
    participant R as RabbitMQ
    participant T as Tour
    participant N as Notification
    U->>C: Nhấn "Mua tour", "Thanh toán"
    C->>G: POST /api/payments/orders { tourId, expectedPrice } (JWT)
    G->>P: chuyển tiếp
    P->>P: Kiểm tra, tạo đơn pending, ký URL
    P-->>C: 201 { orderId, paymentUrl }
    C->>V: Chuyển hướng tới paymentUrl
    U->>V: Thanh toán
    V->>G: GET /api/payments/vnpay/ipn (có chữ ký)
    G->>P: chuyển tiếp
    P->>P: Xác minh chữ ký, số tiền; đơn paid
    P-->>V: { RspCode: "00" }
    P-)R: payment.completed
    R-)T: payment.completed
    T->>T: Ghi tour_purchases
    R-)N: payment.completed
    N->>N: Thông báo trong app, email biên nhận
    V->>C: Chuyển về /payment/result
    C->>G: GET /api/payments/orders/:id
    G->>P: chuyển tiếp
    P-->>C: { status: paid }
    C-->>U: "Thanh toán thành công"
```

## Boundary

- Chi tiết tour `/tour/:tourId`: giá, nhãn "Đã mua", nút "Mua tour", hộp thoại "Xác nhận mua tour".
- Trang VNPay (bên ngoài).
- Trang kết quả `/payment/result`: thành công, đang xác nhận, đã hủy, thất bại, nút "Thử lại" / "Bắt đầu nghe".
- Tài khoản → "Tour đã mua".
- Studio (UC09): ô "Giá (VND)" trong thông tin tour.
