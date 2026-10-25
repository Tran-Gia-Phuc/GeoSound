// =========================================================
// SharedItineraryPage (UC07 / A4) — xem lịch trình được chia sẻ theo mã (công
// khai, chỉ đọc). Bản đồ + danh sách điểm + khoảng cách/thời gian. Có thể "Đi
// theo lịch trình" (UC08) từ bản chia sẻ.
// =========================================================
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import TourMap from '../player/TourMap.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { formatDistance, formatMinutes } from '../../lib/format.js';
import { getSharedItinerary } from '../../lib/itineraries.js';

export default function SharedItineraryPage() {
  const { token } = useParams();
  const { isDark, toggle } = useTheme();
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    getSharedItinerary(token)
      .then(setView)
      .catch((e) => setError(e.message || 'Không mở được lịch trình chia sẻ'));
  }, [token]);

  if (error) {
    return (
      <div className="screen screen--center">
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
        </div>
        <Link to="/" className="btn">Về trang chủ</Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="screen screen--center">
        <p className="muted"><Icon name="loader" size={20} className="spin" /> Đang mở lịch trình…</p>
      </div>
    );
  }

  return (
    <div className="screen itin-edit">
      <header className="itin__top">
        <Link to="/" className="brand" aria-label="Về trang chủ GeoSound">
          <span className="brand__logo"><Icon name="headphones" size={20} /></span>
          <span className="brand__name">GeoSound</span>
        </Link>
        <button className="iconbtn" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
          <Icon name={isDark ? 'sun' : 'moon'} size={18} />
        </button>
      </header>

      <div className="itin-edit__shared-title">
        <span className="chip chip--live"><Icon name="share" size={13} /> Lịch trình được chia sẻ</span>
        <h1 className="itin__h1">{view.name}</h1>
      </div>

      <div className="itin-edit__map">
        <TourMap tour={view} activePlaceId={activeId} onSelectPlace={setActiveId} />
      </div>

      <div className="itin-edit__summary">
        <span><Icon name="map-pin" size={16} /> {view.placeCount} điểm</span>
        <span><Icon name="route" size={16} /> {formatDistance(view.distanceMeters)}</span>
        <span><Icon name="clock" size={16} /> {formatMinutes(view.walkingMinutes)}</span>
      </div>

      <main className="itin-edit__list">
        <ol className="stops">
          {view.places.map((p, i) => (
            <li key={p.id} className={`stop ${activeId === p.id ? 'is-active' : ''}`}>
              <span className="stop__seq">{i + 1}</span>
              <button className="stop__main" onClick={() => setActiveId(p.id)}>
                <span className="stop__name">{p.name}</span>
              </button>
            </li>
          ))}
        </ol>
      </main>

      {view.placeCount ? (
        <footer className="itin-edit__bar">
          <Link className="btn btn--primary btn--block" to={`/shared/${token}/go`}>
            <Icon name="navigation" size={18} /> Đi theo lịch trình này
          </Link>
        </footer>
      ) : null}
    </div>
  );
}
