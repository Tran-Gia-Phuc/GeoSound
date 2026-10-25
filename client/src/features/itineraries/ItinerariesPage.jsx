// =========================================================
// ItinerariesPage (UC07) — "Lịch trình của tôi": danh sách + tạo mới.
// Mỗi lịch trình mở trình chỉnh sửa (/itineraries/:id).
// =========================================================
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import AccountMenu from '../../auth/AccountMenu.jsx';
import { formatDistance, formatMinutes } from '../../lib/format.js';
import { listMyItineraries, createItinerary, deleteItinerary } from '../../lib/itineraries.js';

export default function ItinerariesPage() {
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const [list, setList] = useState(null); // null = đang tải
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setError('');
    try {
      setList(await listMyItineraries());
    } catch (e) {
      setError(e.message || 'Không tải được danh sách');
      setList([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setCreating(true);
    setError('');
    try {
      const it = await createItinerary(v);
      navigate(`/itineraries/${it.id}`);
    } catch (err) {
      setError(err.message || 'Không tạo được lịch trình');
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id, title) => {
    if (!window.confirm(`Xoá lịch trình “${title}”? Hành động này không thể hoàn tác.`)) return;
    try {
      await deleteItinerary(id);
      setList((l) => l.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.message || 'Không xoá được');
    }
  };

  return (
    <div className="screen itin">
      <header className="itin__top">
        <Link to="/" className="brand" aria-label="Về trang chủ GeoSound">
          <span className="brand__logo"><Icon name="headphones" size={20} /></span>
          <span className="brand__name">GeoSound</span>
        </Link>
        <div className="home__topright">
          <AccountMenu />
          <button className="iconbtn" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

      <main className="itin__main">
        <h1 className="itin__h1">Lịch trình của tôi</h1>
        <p className="muted">Tự lên kế hoạch chuyến đi từ các địa điểm bạn quan tâm.</p>

        <form className="itin__create" onSubmit={onCreate}>
          <label htmlFor="itin-name" className="sr-only">Tên lịch trình mới</label>
          <input
            id="itin-name"
            className="input"
            placeholder="Tên lịch trình mới, ví dụ: Hội An 1 ngày…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <button className="btn btn--primary" type="submit" disabled={!name.trim() || creating}>
            {creating ? <Icon name="loader" size={18} className="spin" /> : <Icon name="plus" size={18} />}
            Tạo
          </button>
        </form>

        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        {list === null ? (
          <p className="muted itin__loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
        ) : list.length === 0 ? (
          <div className="emptybox itin__empty">
            <Icon name="route" size={40} />
            <h2>Chưa có lịch trình nào</h2>
            <p>Tạo lịch trình đầu tiên, rồi thêm địa điểm từ mục Khám phá.</p>
            <Link to="/explore" className="btn btn--ghost"><Icon name="search" size={18} /> Khám phá địa điểm</Link>
          </div>
        ) : (
          <ul className="itin__list">
            {list.map((it) => (
              <li key={it.id} className="itin-card">
                <Link to={`/itineraries/${it.id}`} className="itin-card__main">
                  <span className="itin-card__title">{it.name}</span>
                  <span className="itin-card__meta">
                    <span><Icon name="map-pin" size={14} /> {it.placeCount} điểm</span>
                    {it.distanceMeters ? <span><Icon name="route" size={14} /> {formatDistance(it.distanceMeters)}</span> : null}
                    {it.walkingMinutes ? <span><Icon name="clock" size={14} /> {formatMinutes(it.walkingMinutes)}</span> : null}
                    {it.shareToken ? <span className="chip chip--live"><Icon name="share" size={13} /> Đã chia sẻ</span> : null}
                  </span>
                  {it.previewPlaces?.length ? (
                    <span className="itin-card__preview">{it.previewPlaces.join(' · ')}</span>
                  ) : (
                    <span className="itin-card__preview muted">Chưa có điểm nào</span>
                  )}
                </Link>
                <button
                  className="iconbtn itin-card__del"
                  onClick={() => onDelete(it.id, it.name)}
                  aria-label={`Xoá lịch trình ${it.name}`}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
