# UC15 – Gửi tour đi duyệt (Kiểm duyệt AI)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC15 |
| **Use Case Name** | Gửi tour đi duyệt (Kiểm duyệt AI – Tầng 1) |
| **Actor(s)** | Người đăng nội dung (Contributor); Hệ thống AI (Gemini API, NSFW.js, turf.js) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Contributor gửi tour hoàn chỉnh đi duyệt. Hệ thống tự động kiểm duyệt AI (quét text, kiểm tra kết quả quét ảnh NSFW, kiểm tra vị trí điểm so với vùng cấm) và trả kết quả Pass / Warning / Reject kèm lý do. Reject thì trả về cho contributor sửa; Pass/Warning thì chuyển sang hàng chờ Admin duyệt (Tầng 2). |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở tour ở trạng thái **Nháp** và nhấn **"Gửi duyệt"**. | |
| 2 | | Hệ thống kiểm tra điều kiện tối thiểu: có tên tour, mô tả, ngôn ngữ gốc, ≥1 điểm, và **mỗi điểm có text mô tả (bắt buộc)**. *E1* |
| 3 | | Hệ thống chuyển trạng thái sang **"Chờ AI"** và chạy kiểm duyệt tự động: <br>a. Quét text (tiêu đề, mô tả tour, mô tả điểm) bằng Gemini API. <br>b. Kiểm tra kết quả quét ảnh NSFW (đã quét client-side lúc upload – UC10). <br>c. Kiểm tra vị trí các điểm so với vùng cấm bằng turf.js. *E2, E3* |
| 4 | | Hệ thống tổng hợp kết quả: **Pass / Warning / Reject** kèm lý do. *A1, A2* |
| 5 | | (**Pass**) Hệ thống chuyển tour sang **"Chờ Admin duyệt"** và đưa vào hàng chờ của Admin (UC19). |
| 6 | | Hệ thống thông báo *"Đã gửi duyệt thành công"* kèm trạng thái hiện tại. |
| 7 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Kết quả = Warning** → tour vẫn chuyển "Chờ Admin duyệt" nhưng gắn cờ **AI Warning** (ưu tiên đầu hàng chờ); hiển thị cảnh báo + lý do cho contributor, quay về bước 6.

**A2. Kết quả = Reject** → hệ thống **không** đưa vào hàng chờ Admin; chuyển tour về **"Nháp / bị AI từ chối"**, hiển thị lý do cụ thể và yêu cầu sửa rồi gửi lại. Use case kết thúc.

**A3. Xem thử trước khi gửi** → contributor chọn "Xem thử", hệ thống chuyển sang **UC13 – Xem thử tour**; sau đó quay lại bước 1.

## Exception Path

- **E1.** Thiếu điều kiện tối thiểu (chưa có điểm, thiếu text mô tả, thiếu tên/ngôn ngữ) → chặn gửi, liệt kê mục còn thiếu.
- **E2.** Lỗi gọi AI (Gemini API timeout/lỗi) → giữ trạng thái "Chờ AI", thông báo đang xử lý, cho gửi lại sau.
- **E3.** Có điểm trong **vùng cấm** → đánh dấu Warning/Reject tùy mức, chỉ rõ điểm vi phạm.

## Extension Points

- UC13 – Xem thử tour (từ A3); UC19 – Duyệt / từ chối tour (Admin, sau khi tour vào hàng chờ).

## Triggers

Contributor hoàn tất nội dung tour và muốn công khai.

## Assumptions

- Dịch vụ AI (Gemini API) khả dụng; ảnh đã quét NSFW lúc upload (UC10).

## Preconditions

- Contributor đã đăng nhập; tour ở Nháp và đủ nội dung bắt buộc (mỗi điểm có text).

## Post Conditions

- Tour chuyển trạng thái phù hợp: **Chờ Admin duyệt** (Pass) / **Chờ Admin duyệt + AI Warning** (Warning) / **Nháp – cần sửa** (Reject); có bản ghi kết quả kiểm duyệt AI.

## Reference: Business Rules

- Mô hình kiểm duyệt **3 tầng**; UC này là **Tầng 1 – AI tự động** khi nhấn "Gửi duyệt".
- **Reject** → trả contributor sửa, không vào hàng chờ Admin.
- **Pass/Warning** → chuyển Tầng 2 (Admin); tour AI Warning ưu tiên đầu hàng chờ.
- **Text bắt buộc** mỗi điểm (dùng cho kiểm duyệt AI & hiển thị cùng audio).
- Quét text bằng Gemini API, ảnh bằng NSFW.js (client-side), GPS vùng cấm bằng turf.js.

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Màn hình Quản lý tour (nút "Gửi duyệt"), Hộp thoại kết quả kiểm duyệt AI, Màn hình trạng thái tour.
