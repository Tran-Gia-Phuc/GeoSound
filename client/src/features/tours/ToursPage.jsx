// =========================================================
// ToursPage (UC02 bước 1–5, A1) — Tìm & duyệt tour CÔNG KHAI. Không cần đăng nhập.
//   - Ô tìm kiếm + bộ lọc (thành phố, ngôn ngữ, loại) + sắp xếp (phổ biến/đánh
//     giá cao/mới/gần tôi).
//   - Danh sách thẻ tour (ảnh, số điểm, thời lượng, điểm đánh giá, nhãn giọng).
//   - E1: không có kết quả → thông báo + gợi ý mở rộng. E2: mất mạng → thử lại.
//   - "Gần tôi" dùng định vị thiết bị để xếp theo khoảng cách.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import TourCard from './TourCard.jsx';
import {
  searchTours,
  SORT_OPTIONS,
  LANGUAGE_OPTIONS,
  TOUR_TYPE_OPTIONS,
} from '../../lib/tours.js';

const LIMIT = 12;

export default function ToursPage() {

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('popular');
  const [coords, setCoords] = useState(null); // {lat,lng} cho "gần tôi"
  const [geoBusy, setGeoBusy] = useState(false);

  const [data, setData] = useState(null); // { tours, total, page, limit }
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null); // { message, offline }

  const buildParams = useCallback(
    (page) => ({
      q: q.trim() || undefined,
      city: city.trim() || undefined,
      language: language || undefined,
      type: type || undefined,
      sort,
      lat: sort === 'nearby' ? coords?.lat : undefined,
      lng: sort === 'nearby' ? coords?.lng : undefined,
      page,
      limit: LIMIT,
    }),
    [q, city, language, type, sort, coords],
  );

  const runSearch = useCallback(async () => {
    // "Gần tôi" nhưng chưa có vị trí → không gọi, chờ cấp quyền.
    if (sort === 'nearby' && !coords) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await searchTours(buildParams(1));
      setData(r);
    } catch (e) {
      setError({ message: e.offline ? 'Mất kết nối mạng' : e.message || 'Không tải được danh sách tour', offline: e.offline });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [buildParams, sort, coords]);

  // Chạy lại khi đổi bộ lọc/sắp xếp/vị trí (q & city áp dụng khi bấm "Tìm").
  const runRef = useRef(runSearch);
  runRef.current = runSearch;
  useEffect(() => {
    runRef.current();
  }, [sort, language, type, coords]);

  const loadMore = async () => {
    if (!data) return;
    setLoadingMore(true);
    try {
      const r = await searchTours(buildParams(data.page + 1));
      setData((d) => ({ ...r, tours: [...d.tours, ...r.tours] }));
    } catch (e) {
      setError({ message: e.offline ? 'Mất kết nối mạng' : e.message || 'Không tải thêm được', offline: e.offline });
    } finally {
      setLoadingMore(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError({ message: 'Thiết bị không hỗ trợ định vị' });
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSort('nearby');
      },
      () => {
        setGeoBusy(false);
        setError({ message: 'Chưa cấp quyền vị trí — hãy cho phép để xem tour gần bạn.' });
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const onSort = (value) => {
    if (value === 'nearby') {
      if (coords) setSort('nearby');
      else useMyLocation();
      return;
    }
    setSort(value);
  };

  const resetFilters = () => {
    setQ('');
    setCity('');
    setLanguage('');
    setType('');
    setSort('popular');
  };

  const tours = data?.tours ?? [];
  const hasMore = data ? tours.length < data.total : false;
  const hasFilters = !!(q.trim() || city.trim() || language || type);

  return (
    <div className="screen">
      <div className="tours">
        <div>
          <h1 className="tours__h1">Tìm tour</h1>
          <p className="tours__lead">Chọn một tour để nghe thuyết minh theo bước chân, hoặc nghe thử từ xa.</p>
        </div>

        {/* Ô tìm kiếm */}
        <form
          className="searchbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <div className="searchbar__box">
            <Icon name="search" size={18} className="searchbar__icon" />
            <label htmlFor="tour-q" className="sr-only">Từ khoá tìm tour</label>
            <input
              id="tour-q"
              className="input"
              type="search"
              placeholder="Tên tour hoặc từ khoá…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button className="btn btn--primary" type="submit">Tìm</button>
        </form>

        {/* Bộ lọc */}
        <div className="filters" role="group" aria-label="Bộ lọc nâng cao">
          <div className="field">
            <label className="field__label" htmlFor="f-city">Thành phố</label>
            <input
              id="f-city"
              className="input"
              placeholder="Mọi thành phố"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => runSearch()}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="f-lang">Ngôn ngữ</label>
            <select id="f-lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Mọi ngôn ngữ</option>
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="f-type">Loại tour</label>
            <select id="f-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Mọi loại</option>
              {TOUR_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Sắp xếp (A1) */}
        <div className="sorts" role="group" aria-label="Sắp xếp">
          {SORT_OPTIONS.map((o) => {
            const on = sort === o.value;
            return (
              <button
                key={o.value}
                type="button"
                className={`sortchip ${on ? 'sortchip--on' : ''}`}
                aria-pressed={on}
                onClick={() => onSort(o.value)}
              >
                {o.value === 'nearby' ? (
                  <Icon name={geoBusy ? 'loader' : 'crosshair'} size={14} className={geoBusy ? 'spin' : ''} />
                ) : null}
                {o.label}
              </button>
            );
          })}
        </div>

        {/* Lỗi / mất mạng (E2) */}
        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name={error.offline ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
            <div className="banner__text">
              <div className="alert__title">{error.message}</div>
              {error.offline ? 'Kiểm tra kết nối rồi thử lại.' : null}
            </div>
            <button className="btn" onClick={() => runSearch()}>Thử lại</button>
          </div>
        ) : null}

        {/* Kết quả */}
        {loading ? (
          <ul className="tourlist" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="skel-card">
                <div className="skel skel-card__cover" />
                <div className="skel skel-line" style={{ width: '70%' }} />
                <div className="skel skel-line" style={{ width: '45%' }} />
              </li>
            ))}
          </ul>
        ) : !error && tours.length === 0 ? (
          // E1 — không có tour khớp
          <div className="emptybox tours__empty">
            <Icon name="search" size={40} />
            <h2>Không tìm thấy tour phù hợp</h2>
            <p>Thử từ khoá khác, bỏ bớt bộ lọc, hoặc dùng “Gần tôi” để xem tour xung quanh.</p>
            {hasFilters ? (
              <button className="btn btn--ghost" onClick={resetFilters}>Xoá bộ lọc</button>
            ) : null}
          </div>
        ) : (
          <>
            {data ? (
              <p className="tours__count" aria-live="polite">
                {data.total} tour{sort === 'nearby' ? ' gần bạn' : ''}
              </p>
            ) : null}
            <ul className="tourlist">
              {tours.map((t) => (
                <TourCard key={t.id} tour={t} />
              ))}
            </ul>
            {hasMore ? (
              <button className="btn loadmore" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null}
                Xem thêm
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
