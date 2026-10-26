// =========================================================
// AppLayout — khung chung của app (thay 7 kiểu header rời rạc trước đây).
//   - Điện thoại: thanh tab dưới đáy theo vai trò
//       Khám phá · Lịch trình · Studio (chỉ người đóng góp) · Tài khoản
//   - Desktop (≥ 900px): thanh điều hướng trên cùng, nội dung rộng hơn.
// `tabs={false}` cho màn chi tiết có thanh hành động riêng ở đáy (chi tiết tour,
// lịch trình…): vẫn có thanh trên ở desktop nhưng ẩn tab dưới trên điện thoại.
// Màn toàn màn hình (trình phát, đăng nhập) nằm NGOÀI layout này.
// =========================================================
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const TABS = [
  { to: '/', icon: 'search', label: 'Khám phá', match: (p) => p === '/' || p.startsWith('/tour/') },
  { to: '/itineraries', icon: 'route', label: 'Lịch trình', match: (p) => p.startsWith('/itinerar') || p.startsWith('/shared/') },
  { to: '/studio', icon: 'mic', label: 'Studio', match: (p) => p.startsWith('/studio'), contributorOnly: true },
  { to: '/account', icon: 'user', label: 'Tài khoản', match: (p) => p.startsWith('/account') },
];

function initials(user) {
  return (user?.fullName || user?.email || '?').trim().slice(0, 1).toUpperCase();
}

export default function AppLayout({ tabs = true }) {
  const { pathname } = useLocation();
  const { authenticated, user, isContributor } = useAuth();
  const visible = TABS.filter((t) => !t.contributorOnly || isContributor);

  return (
    <div className={`app ${tabs ? 'app--tabs' : ''}`}>
      <header className="topnav">
        <div className="topnav__inner">
          <NavLink to="/" className="brand topnav__brand" aria-label="GeoSound — Khám phá">
            <span className="brand__logo"><Icon name="headphones" size={20} /></span>
            <span className="brand__name">GeoSound</span>
          </NavLink>
          <nav className="topnav__links" aria-label="Điều hướng chính">
            {visible
              .filter((t) => t.to !== '/account')
              .map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={() => `topnav__link ${t.match(pathname) ? 'is-active' : ''}`}
                  aria-current={t.match(pathname) ? 'page' : undefined}
                >
                  {t.label}
                </NavLink>
              ))}
          </nav>
          <NavLink
            to="/account"
            className={() => `topnav__account ${pathname.startsWith('/account') ? 'is-active' : ''}`}
            aria-label="Tài khoản"
          >
            {authenticated ? (
              <span className="topnav__avatar" aria-hidden="true">{initials(user)}</span>
            ) : (
              <span className="btn btn--ghost btn--sm">Đăng nhập</span>
            )}
          </NavLink>
        </div>
      </header>

      <div className="app__content">
        <Outlet />
      </div>

      {tabs ? (
        <nav className="tabbar" aria-label="Điều hướng chính">
          {visible.map((t) => {
            const active = t.match(pathname);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                className={() => `tabbar__item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={t.icon} size={22} />
                <span>{t.label}</span>
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
