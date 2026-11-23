# UC18 – Kiểm tra thủ công UI (Trang tác giả công khai)

- **Ngày kiểm tra:** 2026-11-23
- **Môi trường:** Docker Compose local (`http://localhost:5173`, API Gateway `http://localhost:8080`, commit gốc `21b33d9` trên `develop`)
- **Trình duyệt:** Google Chrome (remote debugging)
- **Tài liệu đối chiếu:** [UC18-trang-tac-gia.md](../use%20case/lam-sau/UC18-trang-tac-gia.md)

## 1. Kết quả kiểm tra theo màn hình & luồng

| STT | Luồng / Màn hình | URL đã kiểm tra | Kết quả | Ghi chú quan sát |
| --- | --- | --- | --- | --- |
| 1 | Điều hướng từ Chi tiết tour → Trang tác giả | `/tour/d261c6b2-9ae3-4915-97b8-58b7dc5ff849` | Đạt | Nút/liên kết **Xem trang tác giả** hiển thị rõ, bấm vào chuyển đúng sang `/authors/1c2c3671-23fc-4f32-926e-8343110432d3`. |
| 2 | Trang tác giả công khai (`AuthorPage`) | `/authors/1c2c3671-23fc-4f32-926e-8343110432d3` | Đạt | Hiển thị đầy đủ tiêu đề `Tác giả`, nút `Quay lại`, avatar chữ viết tắt (`T`), tên `Tác giả Thử`, `0 người theo dõi · Tham gia tháng 11/2026`, nút `+ Theo dõi`. Bio trống được ẩn gọn, không hiện `null`/`undefined`. |
| 3 | Danh sách tour công khai của tác giả | `/authors/1c2c3671-23fc-4f32-926e-8343110432d3` | Đạt | Mục `Tour công khai (15)` hiển thị lưới 2 cột cân đối (tải 12 tour đầu kèm nút `Xem thêm`), không chồng lấp bố cục. |
| 4 | Khách chưa đăng nhập bấm Theo dõi (A3) | `/authors/1c2c3671-23fc-4f32-926e-8343110432d3` | Đạt | Chuyển hướng đúng về `/login?next=%2Fauthors%2F1c2c3671-23fc-4f32-926e-8343110432d3`. |
| 5 | Bảo vệ route Hồ sơ tác giả (`ProfileEditPage`) khi chưa đăng nhập | `/account/profile` | Đạt | Redirect đúng về `/login?next=%2Faccount%2Fprofile`, trang đăng nhập hiển thị sạch sẽ. |
| 6 | Bảo vệ route Đang theo dõi (`FollowingPage`) khi chưa đăng nhập | `/account/following` | Đạt | Redirect đúng về `/login?next=%2Faccount%2Ffollowing`. |

## 2. Lỗi & phạm vi chưa kiểm tra

- **Lỗi JS/UI:** Không ghi nhận lỗi uncaught JS/React hoặc vỡ layout trên `TourDetailPage`, `AuthorPage`, `/login`.
- **Console trình duyệt:** Ghi nhận `401 (Unauthorized)` khi tải lần đầu từ phiên đăng nhập cũ trước khi fallback sang chế độ khách, `404 (Not Found)` (2 request asset ở trang Discover), và 1 cảnh báo accessibility nhẹ trên form đăng nhập.
- **Chưa kiểm tra (chưa đăng nhập tài khoản test):** Thao tác bấm **Theo dõi / Bỏ theo dõi** thực tế, danh sách trong `/account/following`, và sửa thông tin / tải avatar trong `/account/profile`.
