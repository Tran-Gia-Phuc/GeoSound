// =========================================================
// ExplorePage (UC07 bước 1-3) — "Khám phá địa điểm": tìm/lọc địa điểm lẻ thuộc
// tour công khai, xem nhanh, và "Thêm vào lịch trình".
//   /explore?addTo=<itineraryId>  → thêm thẳng vào lịch trình đang mở (từ editor)
//   /explore                      → chọn lịch trình đích (hoặc tạo ở màn Lịch trình)
// E1 (không có kết quả) → gợi ý mở rộng tìm kiếm.
// =========================================================
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatDistance } from '../../lib/format.js';
import { explorePlaces, listMyItineraries, addItem } from '../../lib/itineraries.js';

const TYPE_LABELS = {
  landmark: 'Địa danh', museum: 'Bảo tàng', historical: 'Lịch sử', nature: 'Thiên nhiên',
  food: 'Ẩm thực', shopping: 'Mua sắm', entertainment: 'Giải trí', other: 'Khác',
};

export default function ExplorePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const addTo = params.get('addTo');
  const addToName = location.state?.name;
  const { authenticated } = useAuth();

  const [q, setQ] = useState('');
  const [near, setNear] = useState(null);
  const [res, setRes] = useState(null); // { items, total }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [targets, setTargets] = useState([]);
  const [target, setTarget] = useState(addTo || '');
  const [added, setAdded] = useState({}); // placeId -> true
  const [addingId, setAddingId] = useState(null);

  async function search(opts = {}) {
    setLoading(true);
    setError('');
    try {
      const r = await explorePlaces({ q: q.trim() || undefined, lat: near?.lat, lng: near?.lng, ...opts });
      setRes(r);
    } catch (e) {
      setError(e.message || 'Không tải được địa điểm');
      setRes({ items: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search();
    if (authenticated && !addTo) listMyItineraries().then(setTargets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return setError('Thiết bị không hỗ trợ định vị');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const n = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setNear(n);
        search({ lat: n.lat, lng: n.lng });
      },
      () => setError('Chưa cấp quyền vị trí'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const onAdd = async (placeId) => {
    if (!authenticated) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    const dest = addTo || target;
    if (!dest) {
      setError('Hãy chọn lịch trình đích ở trên trước khi thêm.');
      return;
    }
    setAddingId(placeId);
    setError('');
    try {
      await addItem(dest, placeId);
      setAdded((a) => ({ ...a, [placeId]: true }));
    } catch (e) {
      setError(e.message || 'Không thêm được địa điểm');
    } finally {
      setAddingId(null);
    }
  };

  const items = res?.items ?? [];

  return (
    <div className="screen explore">
      <AppHeader title="Khám phá địa điểm" backTo="/" />

      <main className="itin__main">
        {addTo ? (
          <p className="explore__dest">
            Thêm vào: <b>{addToName || 'lịch trình đang mở'}</b>{' '}
            <Link className="linkbtn" to={`/itineraries/${addTo}`}>Xong</Link>
          </p>
        ) : authenticated ? (
          <div className="field explore__target">
            <label className="field__label" htmlFor="target">Thêm vào lịch trình</label>
            <select id="target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— Chọn lịch trình —</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.placeCount} điểm)</option>
              ))}
            </select>
            {!targets.length ? (
              <p className="field__hint">Chưa có lịch trình. <Link className="linkbtn" to="/itineraries">Tạo một cái</Link> rồi quay lại.</p>
            ) : null}
          </div>
        ) : (
          <p className="muted small">
            <Link className="linkbtn" to="/login">Đăng nhập</Link> để thêm địa điểm vào lịch trình của bạn.
          </p>
        )}

        <form
          className="explore__search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <div className="explore__searchbox">
            <Icon name="search" size={18} className="explore__searchicon" />
            <label htmlFor="q" className="sr-only">Tìm địa điểm</label>
            <input id="q" className="input" placeholder="Tìm theo tên địa điểm…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className={`btn ${near ? 'btn--accent' : 'btn--ghost'}`} onClick={useMyLocation}>
            <Icon name="crosshair" size={18} /> Gần tôi
          </button>
        </form>

        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        {loading ? (
          <p className="muted itin__loading"><Icon name="loader" size={18} className="spin" /> Đang tìm…</p>
        ) : items.length === 0 ? (
          <div className="emptybox itin__empty">
            <Icon name="search" size={40} />
            <h2>Không tìm thấy địa điểm phù hợp</h2>
            <p>Thử từ khoá khác, hoặc dùng “Gần tôi” để xem địa điểm xung quanh.</p>
          </div>
        ) : (
          <ul className="explore__list">
            {items.map((p) => (
              <li key={p.placeId} className="place-card">
                <div className="place-card__thumb" aria-hidden="true">
                  {p.images?.[0]?.url ? (
                    <img src={p.images[0].url} alt="" loading="lazy" />
                  ) : (
                    <Icon name="map-pin" size={22} />
                  )}
                </div>
                <div className="place-card__body">
                  <span className="place-card__name">{p.name}</span>
                  <span className="place-card__meta">
                    <span className="chip">{TYPE_LABELS[p.type] || p.type}</span>
                    {p.city ? <span className="muted small">{p.city}</span> : null}
                    {Number.isFinite(p.distanceMeters) ? <span className="muted small">· {formatDistance(p.distanceMeters)}</span> : null}
                  </span>
                  {p.tourTitle ? <span className="place-card__tour muted small">Từ tour: {p.tourTitle}</span> : null}
                </div>
                {added[p.placeId] ? (
                  <span className="place-card__added"><Icon name="check-circle" size={18} /> Đã thêm</span>
                ) : (
                  <button
                    className="btn btn--primary place-card__add"
                    onClick={() => onAdd(p.placeId)}
                    disabled={addingId === p.placeId}
                  >
                    {addingId === p.placeId ? <Icon name="loader" size={16} className="spin" /> : <Icon name="plus" size={16} />}
                    Thêm
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
