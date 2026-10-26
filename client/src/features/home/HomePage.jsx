// =========================================================
// HomePage — điểm vào tạm để mở trình nghe tour (UC04).
// Thực tế người dùng tới đây từ chi tiết tour (UC02); màn này cho nhập ID tour
// để mở nhanh khi phát triển, và nhớ các tour vừa mở.
// =========================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import AccountMenu from '../../auth/AccountMenu.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const RECENT_KEY = 'geosound:recent-tours';

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { isContributor } = useAuth();
  const [id, setId] = useState('');
  const [recent, setRecent] = useState([]);

  useEffect(() => setRecent(readRecent()), []);

  const open = (tourId) => {
    const v = tourId.trim();
    if (!v) return;
    navigate(`/tour/${encodeURIComponent(v)}`);
  };

  return (
    <div className="screen home">
      <header className="home__top">
        <div className="brand">
          <span className="brand__logo"><Icon name="headphones" size={20} /></span>
          <span className="brand__name">GeoSound</span>
        </div>
        <div className="home__topright">
          <AccountMenu />
          <button className="iconbtn" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

      <main className="home__main">
        <h1 className="home__h1">Nghe tour bằng audio theo bước chân</h1>
        <p className="home__sub">
          Tìm tour theo thành phố hoặc từ khoá, rồi đi theo GPS để tự động nghe thuyết minh tại mỗi điểm — hoặc nghe thử từ xa, không cần GPS.
        </p>

        <Link className="home__searchcta" to="/tours">
          <Icon name="search" size={18} />
          <span>Tìm tour theo thành phố, từ khoá…</span>
          <Icon name="chevron-left" size={16} className="recent__chev" />
        </Link>

        {/* Chỉ dành cho lập trình viên — không lộ ra bản build thật. */}
        {import.meta.env.DEV ? (
        <details className="home__dev">
          <summary>Mở nhanh bằng mã tour (dev)</summary>
        <form
          className="home__open"
          onSubmit={(e) => {
            e.preventDefault();
            open(id);
          }}
        >
          <label htmlFor="tourid" className="sr-only">Mã tour</label>
          <input
            id="tourid"
            className="input"
            placeholder="Dán ID tour (UUID)…"
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
          <button className="btn btn--primary" type="submit" disabled={!id.trim()}>
            Mở tour
          </button>
        </form>
        </details>
        ) : null}

        <nav className="home__nav" aria-label="Lịch trình cá nhân">
          {isContributor ? (
            <Link className="home__navcard" to="/studio">
              <span className="home__navicon"><Icon name="map-pin" size={20} /></span>
              <span className="home__navtext">
                <b>Studio — Tour của tôi</b>
                <span className="muted small">Tạo & quản lý tour audio bạn đóng góp</span>
              </span>
              <Icon name="chevron-left" size={16} className="recent__chev" />
            </Link>
          ) : null}
          <Link className="home__navcard" to="/itineraries">
            <span className="home__navicon"><Icon name="route" size={20} /></span>
            <span className="home__navtext">
              <b>Lịch trình của tôi</b>
              <span className="muted small">Tự lên kế hoạch chuyến đi</span>
            </span>
            <Icon name="chevron-left" size={16} className="recent__chev" />
          </Link>
          <Link className="home__navcard" to="/explore">
            <span className="home__navicon"><Icon name="search" size={20} /></span>
            <span className="home__navtext">
              <b>Khám phá địa điểm</b>
              <span className="muted small">Tìm điểm lẻ để thêm vào lịch trình</span>
            </span>
            <Icon name="chevron-left" size={16} className="recent__chev" />
          </Link>
        </nav>

        {recent.length ? (
          <section className="home__recent">
            <h2 className="home__h2">Mở gần đây</h2>
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <button className="recent__item" onClick={() => open(r.id)}>
                    <span className="recent__icon"><Icon name="map-pin" size={16} /></span>
                    <span className="recent__name">{r.title || r.id}</span>
                    <Icon name="chevron-left" size={16} className="recent__chev" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
