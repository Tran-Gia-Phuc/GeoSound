# UC19 – Duyệt / từ chối tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC19 |
| **Use Case Name** | Duyệt / từ chối tour (Kiểm duyệt Admin – Tầng 2) |
| **Actor(s)** | Admin (Quản trị viên kiểm duyệt) |
| **Priority** | P0 |
| **Maturity** | Focused |
| **Summary** | Admin xem hàng chờ kiểm duyệt (ưu tiên tour có AI Warning), xem chi tiết và preview tour như khách thật, rồi duyệt công khai, từ chối kèm lý do, hoặc yêu cầu contributor chỉnh sửa và gửi lại. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Admin mở trang **"Hàng chờ kiểm duyệt"**. | |
| 2 | | Hệ thống hiển thị danh sách tour chờ duyệt, sắp xếp theo thời gian gửi và **ưu tiên tour có cờ AI Warning lên đầu**. *E1* |
| 3 | Admin chọn một tour để xem chi tiết. | |
| 4 | | Hệ thống hiển thị chi tiết tour: ảnh, mô tả, các điểm, audio, vùng kích hoạt, kết quả AI check kèm lý do (nếu bị flag). |
| 5 | Admin preview tour như một khách thật (GPS giả lập, nghe audio, xem route). *A1* | |
| 6 | Admin ra quyết định **Duyệt**. *A2, A3* | |
| 7 | | Hệ thống chuyển tour sang **"Công khai"**; tour xuất hiện trong tìm kiếm (UC02) và cho phép tải (UC03). |
| 8 | | Hệ thống ghi log hành động và gửi thông báo cho contributor (UC16). |
| 9 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Preview tour** → hệ thống chạy tour ở chế độ GPS giả lập cho Admin, quay về bước 6.

**A2. Từ chối tour** → Admin chọn lý do (danh sách có sẵn hoặc tự do); hệ thống chuyển tour sang **"Bị từ chối"**, ghi log và thông báo contributor kèm lý do (UC16). Use case kết thúc.

**A3. Yêu cầu chỉnh sửa (lỗi nhỏ)** → hệ thống chuyển tour sang **"Cần chỉnh sửa"** và gửi yêu cầu cho contributor để sửa và gửi duyệt lại (UC15). Use case kết thúc.

## Exception Path

- **E1.** Không còn tour nào trong hàng chờ → hiển thị danh sách rỗng.

## Extension Points

- UC15 – Gửi tour đi duyệt (gửi lại); UC16 – Theo dõi trạng thái & thông báo; UC22 – Dashboard thống kê & log.

## Triggers

Có tour ở trạng thái "Chờ Admin duyệt" trong hàng chờ.

## Assumptions

- Chế độ preview GPS giả lập khả dụng.

## Preconditions

- Admin đã đăng nhập; có ít nhất một tour "Chờ Admin duyệt".

## Post Conditions

- Tour chuyển sang **Công khai** / **Bị từ chối** / **Cần chỉnh sửa**; hành động được ghi log; contributor được thông báo.

## Reference: Business Rules

- Đây là **Tầng 2** của mô hình kiểm duyệt 3 tầng (Admin review).
- Tour có **AI Warning** ưu tiên lên đầu hàng chờ.
- **Từ chối phải kèm lý do**; mọi hành động được **ghi log** (UC22).
- Admin **không tạo/sửa nội dung** tour — chỉ quyết định trạng thái.
- *Xem hàng chờ, xem chi tiết, preview* là các action trong use case này (gộp A1–A5 của user story).

## Author(s)

(điền sau)

## Date

2026-10-18

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

(bổ sung sau)

## Boundary

Trang Hàng chờ kiểm duyệt, Màn hình Chi tiết tour chờ duyệt (kèm kết quả AI), Chế độ Preview GPS giả lập, Hộp thoại Từ chối/Yêu cầu chỉnh sửa.
