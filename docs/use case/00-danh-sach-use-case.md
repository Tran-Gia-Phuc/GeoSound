# Danh sách Use Case – Hệ thống GeoSound (audio guide du lịch)

> Nguồn: [ustory.md](ustory.md). Đánh số UC theo **flow người dùng**: Tài khoản → Khách du lịch (Tourist) → Người đăng nội dung (Contributor) → Admin.
> Tổng **22 use case** (đã gộp bớt các UC tách quá mịn), chia 2 thư mục theo thứ tự triển khai.

## Tổ chức thư mục

| Thư mục | Nội dung |
|---|---|
| `lam-truoc/` | **13 UC làm trước** (danh sách đã chọn + UC08 để trọn nhánh lịch trình) |
| `lam-sau/` | **9 UC làm sau** (phần còn lại) |

## Phân biệt Use Case vs Action

- **Use case**: mục tiêu hoàn chỉnh, có điểm bắt đầu & kết thúc, kết quả quan sát được.
- **Action**: một bước bên trong UC (vd *tua audio*, *thả pin*, *chọn ngôn ngữ*, *xem danh sách*) → thuộc Basic/Alternative/Exception flow, không tách thành UC riêng.

## 🟢 Nhóm LÀM TRƯỚC (13 UC) — thư mục `lam-truoc/`

| UC | Tên use case | Actor | Priority | Gộp từ (bản 28) |
|---|---|---|---|---|
| UC01 | [Xác thực tài khoản (Đăng ký/Đăng nhập)](lam-truoc/UC01-xac-thuc-tai-khoan.md) | Tourist / Contributor / Admin | P0 | UC01+UC02 |
| UC02 | [Tìm & xem tour](lam-truoc/UC02-tim-va-xem-tour.md) | Tourist | P0 | UC03+UC04 |
| UC03 | [Quản lý tour offline (tải/xem/xóa)](lam-truoc/UC03-quan-ly-tour-offline.md) | Tourist | P0 | UC05+UC06 |
| UC04 | [Nghe tour (GPS tại chỗ / từ xa)](lam-truoc/UC04-nghe-tour.md) | Tourist | P0 | UC07+UC10 |
| UC07 | [Tạo & quản lý lịch trình cá nhân](lam-truoc/UC07-lich-trinh-ca-nhan.md) | Tourist | P2 | UC11+UC12 |
| UC08 | [Đi theo lịch trình cá nhân](lam-truoc/UC08-di-theo-lich-trinh.md) | Tourist | P2 | UC13 |
| UC09 | [Quản lý tour của mình (tạo/sửa/xóa)](lam-truoc/UC09-quan-ly-tour-cua-minh.md) | Contributor | P0 | UC14+UC15 |
| UC10 | [Thêm & quản lý địa điểm trên tour](lam-truoc/UC10-them-quan-ly-dia-diem.md) | Contributor | P0 | UC16 |
| UC11 | [Vẽ route & cấu hình kích hoạt audio](lam-truoc/UC11-ve-route-cau-hinh-kich-hoat.md) | Contributor | P0 | UC17 |
| UC12 | [Cấu hình đa ngôn ngữ & TTS](lam-truoc/UC12-da-ngon-ngu-tts.md) | Contributor | P1 | UC18 |
| UC13 | [Xem thử tour (preview)](lam-truoc/UC13-xem-thu-tour.md) | Contributor | P1 | UC19 |
| UC15 | [Gửi tour đi duyệt – kiểm duyệt AI](lam-truoc/UC15-gui-tour-di-duyet.md) | Contributor + Hệ thống AI | P0 | UC21 |
| UC19 | [Duyệt / từ chối tour](lam-truoc/UC19-duyet-tu-choi-tour.md) | Admin | P0 | UC25 |

## 🟡 Nhóm LÀM SAU (9 UC) — thư mục `lam-sau/`

| UC | Tên use case | Actor | Priority | Gộp từ (bản 28) |
|---|---|---|---|---|
| UC05 | [Đánh giá & nhận xét tour](lam-sau/UC05-danh-gia-tour.md) | Tourist | P0 | UC08 |
| UC06 | [Báo cáo tour vi phạm](lam-sau/UC06-bao-cao-tour.md) | Tourist | P1 | UC09 |
| UC14 | [Cấu hình truy cập hạn chế bằng passcode](lam-sau/UC14-truy-cap-han-che-passcode.md) | Contributor | P2 | UC20 |
| UC16 | [Theo dõi trạng thái & nhận thông báo](lam-sau/UC16-theo-doi-trang-thai-thong-bao.md) | Contributor | P1 | UC22 |
| UC17 | [Xem thống kê & đánh giá tour](lam-sau/UC17-thong-ke-danh-gia-tour.md) | Contributor | P1 | UC23 |
| UC18 | [Trang tác giả công khai](lam-sau/UC18-trang-tac-gia.md) | Contributor | P2 | UC24 |
| UC20 | [Xử lý báo cáo & vi phạm tour](lam-sau/UC20-xu-ly-bao-cao-vi-pham.md) | Admin | P1 | UC26 |
| UC21 | [Quản lý tài khoản vi phạm](lam-sau/UC21-quan-ly-tai-khoan-vi-pham.md) | Admin | P2 | UC27 |
| UC22 | [Dashboard thống kê & log](lam-sau/UC22-dashboard-thong-ke-log.md) | Admin | P2 | UC28 |

> ⚠️ **Lưu ý:** Danh sách "làm trước" bạn chọn **không có UC05 – Đánh giá & nhận xét tour** (P0), dù nó nằm trong luồng end-to-end cốt lõi (đi tour → đánh giá). Nếu muốn, có thể chuyển UC05 sang `lam-truoc/`.

## 6 nhóm đã gộp

1. **UC01** = Đăng ký + Đăng nhập. 2. **UC02** = Tìm kiếm + Chi tiết tour. 3. **UC03** = Tải + Quản lý tour đã tải. 4. **UC04** = Đi tour (GPS) + Nghe thử từ xa. 5. **UC07** = Tìm địa điểm lẻ + Lịch trình cá nhân. 6. **UC09** = Tạo tour + Quản lý tour.

## Kiểm duyệt 3 tầng (xuyên suốt)

- **Tầng 1 – AI tự động:** UC15 (text Gemini, ảnh NSFW ở UC09/UC10, GPS vùng cấm ở UC10).
- **Tầng 2 – Admin review:** UC19 (duyệt/từ chối/yêu cầu sửa; AI Warning ưu tiên đầu hàng chờ).
- **Tầng 3 – Community report:** UC06 (khách báo cáo) → UC20 (Admin xử lý); ≥5 report/7 ngày → "Chờ Admin xem lại".
