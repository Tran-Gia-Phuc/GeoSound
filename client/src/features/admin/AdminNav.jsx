// =========================================================
// AdminNav — shared navigation of the admin area (/admin/...).
//   ADMIN_LINKS is the single list of admin screens: the /admin home renders it as a menu,
//   every admin page renders it as a row of tabs under its header.
//   A new admin screen adds its entry here.
// =========================================================
import { NavLink } from 'react-router-dom';

export const ADMIN_LINKS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: 'sliders', hint: 'Hàng chờ duyệt, thời gian duyệt, báo cáo, tác giả nổi bật' },
  { to: '/admin/reviews', label: 'Duyệt tour', icon: 'check-circle', hint: 'Hàng chờ duyệt: cảnh báo AI trước, duyệt, từ chối hoặc yêu cầu chỉnh sửa' },
  { to: '/admin/reports', label: 'Tour bị báo cáo', icon: 'alert-triangle', hint: 'Xử lý báo cáo vi phạm của du khách' },
  { to: '/admin/users', label: 'Tài khoản', icon: 'user', hint: 'Tìm tài khoản, cảnh báo, tạm khoá, cấm hoặc khôi phục' },
  { to: '/admin/actions', label: 'Nhật ký hành động', icon: 'list', hint: 'Ai đã duyệt, ẩn, cấm gì và khi nào (chỉ đọc)' },
  { to: '/admin/devices', label: 'Thiết bị đang online', icon: 'eye', hint: 'Số thiết bị và tài khoản đang hoạt động' },
];

export default function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="Quản trị">
      {ADMIN_LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} className={({ isActive }) => `admin-nav__link${isActive ? ' is-active' : ''}`}>
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
