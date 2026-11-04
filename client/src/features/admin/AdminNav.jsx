// =========================================================
// AdminNav — shared navigation of the admin area (/admin/...).
//   ADMIN_LINKS is the single list of admin screens: the /admin home renders it as a menu,
//   every admin page renders it as a row of tabs under its header.
//   Later use cases add their entry here (UC22 "Dashboard").
// =========================================================
import { NavLink } from 'react-router-dom';

export const ADMIN_LINKS = [
  { to: '/admin/reports', label: 'Tour bị báo cáo', icon: 'alert-triangle', hint: 'Xử lý báo cáo vi phạm của du khách' },
  { to: '/admin/users', label: 'Tài khoản', icon: 'user', hint: 'Tìm tài khoản, cảnh báo, tạm khoá, cấm hoặc khôi phục' },
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
