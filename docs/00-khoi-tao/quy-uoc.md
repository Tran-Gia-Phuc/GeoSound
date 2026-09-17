# Quy ước (tóm tắt khởi tạo)

Chi tiết Git nằm ở [CONTRIBUTING.md](../../CONTRIBUTING.md). File này chỉ những quy ước cần nhớ khi viết docs và chuẩn bị code.

## Tài liệu

- Viết tiếng Việt, câu ngắn, một ý một đoạn.
- Tên file: chữ thường, không dấu, phân tách bằng `-` (ví dụ `cau-truc-thu-muc.md`).
- Link tương đối giữa các file trong `docs/`.
- Đầu file có thể dùng blockquote `>` nếu nội dung còn là bản nháp.

## Mã nguồn (khi bắt đầu code)

- Không commit bí mật; dùng `.env.example` để liệt kê biến, không điền giá trị thật.
- Một nhánh một việc; PR vào `develop`.
- Tên thư mục / file code: tiếng Anh, kebab-case hoặc theo chuẩn stack đã chọn.

## Đánh số giai đoạn docs

Giữ nguyên tiền tố `00` … `04`. Thêm giai đoạn mới (ví dụ `05-bao-cao`) chỉ khi cả nhóm đồng ý, và cập nhật [docs/README.md](../README.md).
