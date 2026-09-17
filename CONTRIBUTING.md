# Quy ước làm việc

Tài liệu này mô tả cách nhóm cộng tác trên Git. Mục tiêu: mỗi bước (khởi tạo, yêu cầu, thiết kế, triển khai, kiểm thử) có nhánh riêng, dễ review và dễ gộp về `develop`.

## Mô hình nhánh

```text
main
  └── staging
        └── develop
              └── feature/<ten-viec>
              └── docs/<ten-tai-lieu>
              └── fix/<ten-loi>
```

- Tách nhánh tính năng / tài liệu **từ `develop`**.
- Không commit trực tiếp lên `main`, `staging`, `develop` trừ khi nhóm thống nhất.
- Một nhánh = một mục đích. Không trộn docs với code không liên quan.

## Đặt tên nhánh

| Tiền tố | Khi nào dùng | Ví dụ |
| --- | --- | --- |
| `feature/` | Tính năng hoặc khởi tạo có phạm vi rõ | `feature/init-project` |
| `docs/` | Chỉ chỉnh tài liệu | `docs/srs-login` |
| `fix/` | Sửa lỗi | `fix/auth-token-expired` |
| `chore/` | Việc lặt vặt (gitignore, format) | `chore/add-editorconfig` |

Tên viết thường, dùng dấu `-`, ngắn và nói được việc đang làm.

## Commit

- Một commit làm một việc, message bằng tiếng Việt hoặc tiếng Anh — thống nhất trong một nhánh.
- Dạng gợi ý: `<type>: <mô tả ngắn>`

| Type | Ý nghĩa |
| --- | --- |
| `feat` | Thêm chức năng |
| `docs` | Tài liệu |
| `fix` | Sửa lỗi |
| `chore` | Cấu hình, dọn dẹp |
| `test` | Thêm / sửa kiểm thử |
| `refactor` | Đổi code, không đổi hành vi |

Ví dụ: `docs: thêm cấu trúc thư mục và quy ước khởi tạo`.

## Luồng làm việc gợi ý

1. `git checkout develop && git pull`
2. `git checkout -b feature/<ten-viec>`
3. Làm việc, commit nhỏ, rõ ràng
4. Đẩy nhánh: `git push -u origin HEAD`
5. Mở pull request **vào `develop`**
6. Review xong mới gộp; xóa nhánh feature sau khi gộp

## Tài liệu

- Thêm hoặc sửa file trong `docs/` theo đúng giai đoạn (`00` → `04`).
- Mỗi thư mục giai đoạn có `README.md` làm mục lục.
- Không xóa tài liệu cũ khi cập nhật: ghi chú phiên bản / ngày trong đầu file nếu nội dung đổi lớn.

## Những thứ không đưa vào Git

Bí mật (`.env`, khóa), `node_modules/`, thư mục build, file IDE. Xem `.gitignore`.
