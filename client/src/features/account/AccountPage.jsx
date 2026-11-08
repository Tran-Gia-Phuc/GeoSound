// =========================================================
// AccountPage (/account) — tab "Tài khoản":
//   - Chưa đăng nhập: Đăng nhập / Đăng ký (khách không bắt buộc có tài khoản).
//   - Đã đăng nhập: hồ sơ, lối tắt Thông báo (UC16) / Hồ sơ, Tác giả đang theo dõi (UC18) / Lịch trình / Thiết bị (UC23) / Studio, trở thành tác giả, đăng xuất.
//   - Mọi người (cả khách): lối tắt "Tour đã tải" (UC03, dữ liệu trên thiết bị).
//   - Giao diện sáng / tối / theo hệ thống (chuyển vào đây từ mọi header).
// =========================================================
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useTheme, THEME_OPTIONS } from '../../hooks/useTheme.js';
import { badgeText, useUnreadCount } from '../notifications/UnreadCount.jsx';

const ROLE_LABELS = { tourist: 'Khách du lịch', contributor: 'Tác giả tour', admin: 'Quản trị viên' };

export default function AccountPage() {
  const navigate = useNavigate();
  const { authenticated, user, isContributor, isAdmin, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { unread } = useUnreadCount();

  return (
    <div className="page page--narrow">
      <AppHeader title="Tài khoản" large />

      {authenticated ? (
        <section className="card account-card">
          <span className="account-card__avatar" aria-hidden="true">
            {(user?.fullName || user?.email || '?').trim().slice(0, 1).toUpperCase()}
          </span>
          <div className="account-card__info">
            <b>{user?.fullName || 'Chưa đặt tên'}</b>
            <span className="muted small">{user?.email}</span>
            <span className="chip">{ROLE_LABELS[user?.role] || user?.role}</span>
          </div>
        </section>
      ) : (
        <section className="card account-guest">
          <Icon name="user" size={32} />
          <div>
            <b>Bạn đang dùng với tư cách khách</b>
            <p className="muted small">Vẫn nghe được mọi tour. Đăng nhập để lưu lịch trình, hoặc tạo tour audio của riêng bạn.</p>
          </div>
          <div className="row">
            <Link className="btn btn--primary" to="/login">Đăng nhập</Link>
            <Link className="btn btn--ghost" to="/register">Đăng ký</Link>
          </div>
        </section>
      )}

      {authenticated ? (
        <nav className="menu" aria-label="Lối tắt">
          <Link className="menu__item" to="/notifications">
            <Icon name="bell" size={20} /> <span>Thông báo</span>
            {unread ? (
              <span className="notif-badge notif-badge--inline">
                {badgeText(unread)}<span className="sr-only"> chưa đọc</span>
              </span>
            ) : null}
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          <Link className="menu__item" to="/account/profile">
            <Icon name="edit" size={20} /> <span>{isContributor ? 'Hồ sơ tác giả' : 'Hồ sơ'}</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          {isContributor && user?.id ? (
            <Link className="menu__item" to={`/authors/${encodeURIComponent(user.id)}`}>
              <Icon name="eye" size={20} /> <span>Xem trang tác giả của tôi</span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </Link>
          ) : null}
          <Link className="menu__item" to="/account/following">
            <Icon name="star" size={20} /> <span>Tác giả đang theo dõi</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          <Link className="menu__item" to="/itineraries">
            <Icon name="route" size={20} /> <span>Lịch trình của tôi</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          <Link className="menu__item" to="/account/devices">
            <Icon name="user" size={20} /> <span>Thiết bị đang đăng nhập</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          <Link className="menu__item" to="/account/password">
            <Icon name="lock" size={20} /> <span>Đổi mật khẩu</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          {isAdmin ? (
            <Link className="menu__item" to="/admin">
              <Icon name="sliders" size={20} />
              <span>
                Quản trị
                <span className="muted small menu__sub">Dashboard, báo cáo vi phạm, tài khoản, nhật ký</span>
              </span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </Link>
          ) : null}
          {isAdmin ? (
            <Link className="menu__item" to="/admin/devices">
              <Icon name="eye" size={20} /> <span>Thiết bị đang online (Quản trị)</span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </Link>
          ) : null}
          {isContributor ? (
            <Link className="menu__item" to="/studio">
              <Icon name="mic" size={20} /> <span>Studio — tour của tôi</span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </Link>
          ) : (
            <button
              className="menu__item"
              onClick={() => {
                logout();
                navigate('/register?role=contributor');
              }}
            >
              <Icon name="mic" size={20} />
              <span>
                Trở thành tác giả tour
                <span className="muted small menu__sub">Đăng ký tài khoản tác giả (email khác)</span>
              </span>
              <Icon name="chevron-left" size={16} className="menu__chev" />
            </button>
          )}
        </nav>
      ) : null}

      {/* UC03: offline tours live on this device, no account needed. */}
      <nav className="menu" aria-label="Trên thiết bị này">
        <Link className="menu__item" to="/offline">
          <Icon name="download" size={20} />
          <span>
            Tour đã tải
            <span className="muted small menu__sub">Nghe khi không có mạng, quản lý dung lượng</span>
          </span>
          <Icon name="chevron-left" size={16} className="menu__chev" />
        </Link>
      </nav>

      <section className="card">
        <h2 className="section-title">Giao diện</h2>
        <div className="segmented" role="radiogroup" aria-label="Giao diện sáng tối">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={theme === o.value}
              className={`segmented__item ${theme === o.value ? 'is-active' : ''}`}
              onClick={() => setTheme(o.value)}
            >
              <Icon name={o.value === 'dark' ? 'moon' : o.value === 'light' ? 'sun' : 'sliders'} size={16} />
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {authenticated ? (
        <button
          className="btn btn--ghost btn--block account-logout"
          onClick={() => {
            logout();
            navigate('/', { replace: true });
          }}
        >
          <Icon name="arrow-left" size={18} /> Đăng xuất
        </button>
      ) : null}
    </div>
  );
}
