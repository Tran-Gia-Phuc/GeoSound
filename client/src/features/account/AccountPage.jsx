// =========================================================
// AccountPage (/account) — tab "Tài khoản":
//   - Chưa đăng nhập: Đăng nhập / Đăng ký (khách không bắt buộc có tài khoản).
//   - Đã đăng nhập: hồ sơ, lối tắt Lịch trình / Thiết bị (UC23) / Studio, trở thành tác giả, đăng xuất.
//   - Giao diện sáng / tối / theo hệ thống (chuyển vào đây từ mọi header).
// =========================================================
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useTheme, THEME_OPTIONS } from '../../hooks/useTheme.js';

const ROLE_LABELS = { tourist: 'Khách du lịch', contributor: 'Tác giả tour', admin: 'Quản trị viên' };

export default function AccountPage() {
  const navigate = useNavigate();
  const { authenticated, user, isContributor, logout } = useAuth();
  const { theme, setTheme } = useTheme();

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
          <Link className="menu__item" to="/itineraries">
            <Icon name="route" size={20} /> <span>Lịch trình của tôi</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
          <Link className="menu__item" to="/account/devices">
            <Icon name="user" size={20} /> <span>Thiết bị đang đăng nhập</span>
            <Icon name="chevron-left" size={16} className="menu__chev" />
          </Link>
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
