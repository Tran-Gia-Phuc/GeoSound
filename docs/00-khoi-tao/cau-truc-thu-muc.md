# Cấu trúc thư mục

```text
GeoSound/
├── .gitignore
├── README.md
├── CONTRIBUTING.md
├── docs/
│   ├── README.md
│   ├── 00-khoi-tao/
│   ├── 01-yeu-cau/
│   ├── 02-thiet-ke/
│   ├── 03-kiem-thu/
│   └── 04-huong-dan/
├── frontend/
├── backend/
└── tests/
```

## Gốc repo

| Đường dẫn | Vai trò |
| --- | --- |
| `README.md` | Cổng vào: dự án là gì, cây thư mục, link docs |
| `CONTRIBUTING.md` | Cách tách nhánh, commit, mở PR |
| `.gitignore` | Loại file không đưa lên remote |

## `docs/`

Mỗi giai đoạn một thư mục, đánh số để giữ thứ tự đọc. File `README.md` trong từng thư mục là mục lục giai đoạn đó.

Không đặt mã nguồn trong `docs/`. Không đặt tài liệu thiết kế / đặc tả rải ở gốc repo.

## `frontend/` và `backend/`

Chỗ đặt ứng dụng client và server khi nhóm chốt stack. Hiện để trống có chủ đích (`.gitkeep` để Git giữ thư mục).

Khi scaffold:

- Toàn bộ dependency và file cấu hình của client nằm trong `frontend/`.
- Toàn bộ API, nghiệp vụ, CSDL phía server nằm trong `backend/`.
- Cập nhật README gốc: lệnh cài đặt, chạy, biến môi trường.

Nếu sau này chọn monorepo khác (ví dụ `apps/web`, `apps/api`), sửa file này và README cho khớp — đừng để hai cấu trúc song song.

## `tests/`

Kiểm thử tự động dùng chung hoặc kiểm thử tích hợp. Kiểm thử đơn vị sát mã nguồn có thể nằm cạnh code (`frontend/…`, `backend/…`) tùy công cụ; khi đó ghi chú trong `docs/03-kiem-thu/`.
