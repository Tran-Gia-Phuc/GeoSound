// =========================================================
// HomePage — điểm vào tạm để mở trình nghe tour (UC04).
// Thực tế người dùng tới đây từ chi tiết tour (UC02); màn này cho nhập ID tour
// để mở nhanh khi phát triển, và nhớ các tour vừa mở.
// =========================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import AccountMenu from '../../auth/AccountMenu.jsx';

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
          Mở một tour, bắt đầu đi theo GPS để tự động nghe thuyết minh tại mỗi điểm — hoặc nghe thử từ xa, không cần GPS.
        </p>

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
        ) : (
          <p className="muted small home__hint">
            Mẹo: từ chi tiết tour (UC02), nút “Bắt đầu tour” và “Nghe thử từ xa” sẽ mở màn hình này.
          </p>
        )}
      </main>
    </div>
  );
}
