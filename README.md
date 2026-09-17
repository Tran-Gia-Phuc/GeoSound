# GeoSound

Đồ án môn **Công nghệ phần mềm 2** — Đại học Sài Gòn.

Repo này chứa mã nguồn, tài liệu và quy ước làm việc của nhóm. Bước hiện tại: **khởi tạo dự án** (cấu trúc thư mục + tài liệu nền).

## Cấu trúc thư mục

```text
GeoSound/
├── docs/                 # Tài liệu dự án theo từng giai đoạn
│   ├── 00-khoi-tao/      # Tầm nhìn, phạm vi, quy ước
│   ├── 01-yeu-cau/       # Đặc tả yêu cầu (bổ sung sau)
│   ├── 02-thiet-ke/      # Thiết kế hệ thống (bổ sung sau)
│   ├── 03-kiem-thu/      # Kế hoạch & ca kiểm thử (bổ sung sau)
│   └── 04-huong-dan/     # Hướng dẫn cài đặt / sử dụng (bổ sung sau)
├── frontend/             # Ứng dụng phía client
├── backend/              # Dịch vụ phía server
├── tests/                # Kiểm thử tự động
├── CONTRIBUTING.md       # Quy ước nhánh, commit, review
└── README.md
```

Chi tiết từng thư mục: [docs/00-khoi-tao/cau-truc-thu-muc.md](docs/00-khoi-tao/cau-truc-thu-muc.md).

## Tài liệu

| Giai đoạn | Mục đích | Trạng thái |
| --- | --- | --- |
| [Khởi tạo](docs/00-khoi-tao/) | Tầm nhìn, phạm vi, quy ước làm việc | Đang soạn |
| [Yêu cầu](docs/01-yeu-cau/) | Đặc tả chức năng / phi chức năng | Chưa bắt đầu |
| [Thiết kế](docs/02-thiet-ke/) | Kiến trúc, CSDL, giao diện | Chưa bắt đầu |
| [Kiểm thử](docs/03-kiem-thu/) | Chiến lược và ca kiểm thử | Chưa bắt đầu |
| [Hướng dẫn](docs/04-huong-dan/) | Cài đặt, triển khai, sử dụng | Chưa bắt đầu |

Chỉ mục đầy đủ: [docs/README.md](docs/README.md).

## Nhánh Git

Repo dùng 3 nhánh dài hạn:

| Nhánh | Vai trò |
| --- | --- |
| `main` | Bản ổn định, sẵn sàng nộp / demo |
| `staging` | Tích hợp trước khi lên `main` |
| `develop` | Phát triển chung của nhóm |

Việc khởi tạo này nằm trên `feature/init-project` (tách từ `develop`). Cách đặt tên nhánh, commit và mở pull request: [CONTRIBUTING.md](CONTRIBUTING.md).

## Công nghệ

Chưa chốt stack. Sẽ cập nhật README và `docs/00-khoi-tao/` ngay khi nhóm thống nhất frontend, backend và CSDL.

## Liên hệ repo

- Remote: [Tran-Gia-Phuc/GeoSound](https://github.com/Tran-Gia-Phuc/GeoSound)
