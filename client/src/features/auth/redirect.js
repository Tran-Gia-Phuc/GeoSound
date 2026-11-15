// Điều hướng sau khi vào được tài khoản (UC01 bước 6):
//   - có ?next= (bị chặn ở một màn cần đăng nhập) → quay lại đó
//   - không có: người đóng góp → Studio, khách du lịch → Khám phá
// Chỉ nhận đường dẫn nội bộ ("/..."), chặn open-redirect kiểu "//evil.com".
export function safeNext(raw) {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

export function destinationFor(user, next) {
  return safeNext(next) || (user?.role === 'contributor' ? '/studio' : '/');
}

// Lời dẫn theo ngữ cảnh người dùng đang muốn làm gì.
export function leadFor(next) {
  const n = safeNext(next) || '';
  if (n.startsWith('/studio')) return 'Đăng nhập bằng tài khoản tác giả để vào Studio.';
  if (n.startsWith('/itinerar')) return 'Đăng nhập để lưu và đi theo lịch trình của bạn.';
  return 'Đăng nhập để lưu lịch trình, hoặc tạo tour audio của riêng bạn.';
}
