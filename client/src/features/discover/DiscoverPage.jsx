// =========================================================
// DiscoverPage (/) — màn "Khám phá" gộp Trang chủ + Tìm tour (UC02) + Khám phá
// địa điểm (UC07 bước 1–3). Vừa mở đã có nội dung: Gần bạn + Phổ biến.
//   - Ô tìm thật, gõ là tìm (debounce 300 ms); chuyển [Tour | Địa điểm]
//   - Chip thành phố cuộn ngang; bộ lọc chi tiết nằm trong bottom sheet "Lọc (n)"
//   - Danh sách ⇄ Bản đồ (?view=map): tour ghim tại điểm xuất phát, địa điểm tại chỗ
//   - TOÀN BỘ state nằm trong URL (?tab=&q=&city=&lang=&type=&sort=&view=) → vào chi
//     tiết rồi quay lại không mất kết quả, chia sẻ link được
//   - Tab Địa điểm: chạm thẻ → sheet chi tiết (nghe thử); "＋" → thêm vào lịch
//     trình (chọn / tạo lịch trình tại chỗ). ?addTo=<id> (từ trình sửa lịch trình)
//     → "＋" thêm thẳng vào lịch trình đó.
// /tours và /explore chuyển hướng về đây.
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import TourCard from '../tours/TourCard.jsx';
import PlaceDetailSheet from './PlaceDetailSheet.jsx';
import DiscoverMap from './DiscoverMap.jsx';
import AddToItinerarySheet from '../itineraries/AddToItinerarySheet.jsx';
import { searchTours, SORT_OPTIONS, LANGUAGE_OPTIONS, TOUR_TYPE_OPTIONS } from '../../lib/tours.js';
import { explorePlaces, addItem } from '../../lib/itineraries.js';
import { PLACE_TYPE_OPTIONS, PLACE_TYPE_LABELS } from '../../lib/studio.js';
import { formatDistance } from '../../lib/format.js';
import { usePendingAdd } from '../../hooks/usePendingAdd.js';

import './discover-a.css';

const LIMIT = 12;
const RECENT_KEY = 'geosound:recent-tours';

function readRecent() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(saved)
      ? saved.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string').slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Vị trí người dùng cho "Gần bạn" / "Gần tôi". Tự lấy nếu đã được cấp quyền từ
// trước (không hỏi quyền lúc vừa mở app).
function useCoords() {
  const [coords, setCoords] = useState(null);
  const [state, setState] = useState('idle'); // idle | asking | denied | unsupported
  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setState('unsupported');
      return;
    }
    setState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState('idle');
      },
      () => setState('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => p.state === 'granted' && locate())
      .catch(() => {});
  }, [locate]);
  return { coords, state, locate };
}

export default function DiscoverPage() {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const toast = useToast();
  const tab = sp.get('tab') === 'places' ? 'places' : 'tours';
  const q = sp.get('q') || '';
  const city = sp.get('city') || '';
  const lang = sp.get('lang') || '';
  const type = sp.get('type') || '';
  const sort = sp.get('sort') || (tab === 'places' ? 'recent' : 'popular');
  const addTo = sp.get('addTo');
  const asMap = sp.get('view') === 'map';
  const addToName = location.state?.name;

  const setParams = useCallback(
    (patch) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true, state: location.state },
      ),
    [setSp, location.state],
  );

  // Ô tìm: gõ là tìm (debounce), giá trị cuối nằm trong URL.
  const [qInput, setQInput] = useState(q);
  const qDebounced = useDebounced(qInput, 300);
  useEffect(() => {
    if (qDebounced.trim() !== q) setParams({ q: qDebounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced]);
  useEffect(() => setQInput(q), [q]); // URL đổi (back/forward) → đồng bộ ô tìm

  const { coords, state: geoState, locate } = useCoords();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ---------- Dữ liệu ----------
  const [popular, setPopular] = useState(null); // { tours, total, page }
  const [nearby, setNearby] = useState(null);
  const [nearbyError, setNearbyError] = useState('');
  const [resultState, setResultState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const requestGeneration = useRef(0);
  const moreRequest = useRef(null);
  const [error, setError] = useState(null);
  const [recent] = useState(readRecent);

  const filterCount = [city, lang, type].filter(Boolean).length;
  const toursLanding = tab === 'tours' && !q && !filterCount && sort === 'popular';
  const wantNearby = sort === 'nearby';
  // Chỉ phụ thuộc vị trí khi đang sắp "gần tôi" (tránh tải lại khi vị trí tới muộn).
  const near = wantNearby ? coords : null;
  // URL changes render before effects run. Never expose a previous query's
  // payload (especially places.items as tours.tours) during that render.
  const resultKey = JSON.stringify([tab, q, city, lang, type, sort, near?.lat, near?.lng]);
  const results = resultState?.key === resultKey ? resultState.data : null;

  // Phổ biến (luôn tải 1 lần — cũng dùng để gợi ý chip thành phố).
  useEffect(() => {
    let alive = true;
    searchTours({ sort: 'popular', limit: LIMIT })
      .then((r) => { if (alive) { setPopular(r); if (toursLanding) setError(null); } })
      .catch((e) => { if (alive && toursLanding) setError({ message: e.offline ? 'Mất kết nối mạng' : e.message, offline: e.offline }); });
    return () => { alive = false; };
  }, [retryKey, toursLanding]);

  // Gần bạn — khi đã có vị trí.
  useEffect(() => {
    if (!coords) return;
    let alive = true;
    setNearby(null);
    setNearbyError('');
    searchTours({ sort: 'nearby', lat: coords.lat, lng: coords.lng, limit: 8 })
      .then((r) => { if (alive) setNearby(r.tours); })
      .catch((e) => { if (alive) setNearbyError(e.message || 'Không tải được tour gần bạn.'); });
    return () => { alive = false; };
  }, [coords, retryKey]);

  const query = useCallback(
    (page) => {
      if (tab === 'places') {
        return explorePlaces({
          q: q || undefined,
          city: city || undefined,
          type: type || undefined,
          lat: near?.lat,
          lng: near?.lng,
          page,
          pageSize: LIMIT,
        });
      }
      return searchTours({
        q: q || undefined,
        city: city || undefined,
        language: lang || undefined,
        type: type || undefined,
        sort,
        lat: near?.lat,
        lng: near?.lng,
        page,
        limit: LIMIT,
      });
    },
    [tab, q, city, lang, type, sort, near],
  );

  // Kết quả theo bộ lọc (tab Tour khi có lọc/tìm; tab Địa điểm luôn).
  useEffect(() => {
    requestGeneration.current += 1;
    moreRequest.current = null;
    setLoadingMore(false);
    if (toursLanding) {
      setResultState(null);
      setLoading(false);
      return undefined;
    }
    if (wantNearby && !coords) {
      locate();
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setResultState(null);
    setError(null);
    query(1)
      .then((r) => alive && setResultState({ key: resultKey, data: r }))
      .catch((e) => alive && setError({ message: e.offline ? 'Mất kết nối mạng' : e.message || 'Không tải được', offline: e.offline }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      requestGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toursLanding, query, retryKey, resultKey]);

  const loadMore = async (which) => {
    if (moreRequest.current || (which === 'popular' ? !popular : !results)) return;
    const request = {};
    moreRequest.current = request;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setError(null);
    try {
      if (which === 'popular') {
        const r = await searchTours({ sort: 'popular', page: popular.page + 1, limit: LIMIT });
        if (generation === requestGeneration.current) setPopular((p) => ({ ...r, tours: [...p.tours, ...r.tours] }));
      } else {
        const r = await query(results.page + 1);
        if (generation === requestGeneration.current) setResultState((current) => {
          if (current?.key !== resultKey) return current;
          const field = tab === 'places' ? 'items' : 'tours';
          return { key: resultKey, data: { ...r, [field]: [...current.data[field], ...r[field]] } };
        });
      }
    } catch (e) {
      if (generation === requestGeneration.current) setError({ message: e.message || 'Không tải thêm được', retryMore: which });
    } finally {
      if (moreRequest.current === request) moreRequest.current = null;
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  };

  // Chip thành phố: từ các tour phổ biến (không cần API riêng).
  const cities = useMemo(() => {
    const set = new Set((popular?.tours || []).map((t) => t.city).filter(Boolean));
    if (city) set.add(city);
    return [...set].slice(0, 10);
  }, [popular, city]);

  // ---------- Địa điểm: chi tiết + thêm vào lịch trình ----------
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(null); // place cho AddToItinerarySheet
  const [addedIds, setAddedIds] = useState({});
  const [addingId, setAddingId] = useState(null);

  // Vừa đăng nhập xong để thêm một địa điểm → mở lại sheet "Thêm vào…".
  const [pendingAdd, clearPendingAdd] = usePendingAdd();
  useEffect(() => {
    if (!pendingAdd) return;
    setAdding(pendingAdd);
    clearPendingAdd();
  }, [pendingAdd, clearPendingAdd]);

  const onAddPlace = async (place) => {
    setDetail(null);
    if (!addTo) {
      setAdding(place);
      return;
    }
    // Từ trình sửa lịch trình: thêm thẳng vào lịch trình đang mở.
    setAddingId(place.placeId);
    try {
      await addItem(addTo, place.placeId);
      setAddedIds((s) => ({ ...s, [place.placeId]: true }));
      toast.show(`Đã thêm “${place.name}”${addToName ? ` vào ${addToName}` : ''}`);
    } catch (e) {
      toast.show(e.message || 'Không thêm được địa điểm', { tone: 'danger' });
    } finally {
      setAddingId(null);
    }
  };

  const switchTab = (t) => setParams({ tab: t === 'tours' ? '' : t, sort: '', lang: t === 'places' ? '' : lang, type: '' });
  const resetFilters = () => {
    setQInput('');
    setParams({ q: '', city: '', lang: '', type: '', sort: '' });
  };

  const sortOptions = tab === 'places'
    ? [{ value: 'recent', label: 'Mới cập nhật' }, { value: 'nearby', label: 'Gần tôi' }]
    : SORT_OPTIONS;

  // ---------- Render ----------
  return (
    <div className="page discover discover-a">
      <header className="discover__head discover-a__hero">
        <span className="discover-a__eyebrow"><Icon name="headphones" size={18} /> GeoSound · Nghe câu chuyện nơi bạn đến</span>
        <h1 className="discover__title">Khám phá thế giới<br />qua những câu chuyện âm thanh</h1>
        <p>Tour audio theo bước chân của bạn. Tìm điểm đến mới hoặc nghe từ xa ngay tại nhà.</p>
        <Icon name="headphones" className="discover-a__illustration" size={130} />
      </header>

      {addTo ? (
        <div className="alert discover__addto" role="status">
          <Icon name="route" size={18} className="alert__icon" />
          <div>
            Đang thêm địa điểm vào <b>{addToName || 'lịch trình của bạn'}</b>. Chạm ＋ để thêm.
          </div>
          <Link className="btn btn--sm" to={`/itineraries/${addTo}`}>Xong</Link>
        </div>
      ) : null}

      <form className="discover__search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" size={18} className="discover__searchicon" />
        <label htmlFor="discover-q" className="sr-only">Tìm kiếm</label>
        <input
          id="discover-q"
          className="input"
          type="search"
          placeholder={tab === 'places' ? 'Tìm địa điểm: chùa, chợ, bảo tàng…' : 'Tìm tour, thành phố, chủ đề…'}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        {qInput ? (
          <button type="button" className="discover__clear" onClick={() => setQInput('')} aria-label="Xoá từ khoá">
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </form>

      <div className="discover__bar">
        <div className="segmented discover__tabs" role="tablist" aria-label="Loại nội dung">
          {[
            { v: 'tours', label: 'Tour', icon: 'headphones' },
            { v: 'places', label: 'Địa điểm', icon: 'map-pin' },
          ].map((o) => (
            <button
              key={o.v}
              role="tab"
              aria-selected={tab === o.v}
              className={`segmented__item ${tab === o.v ? 'is-active' : ''}`}
              onClick={() => switchTab(o.v)}
            >
              <Icon name={o.icon} size={16} /> {o.label}
            </button>
          ))}
        </div>
        <button
          className="iconbtn discover__view"
          onClick={() => setParams({ view: asMap ? '' : 'map' })}
          aria-label={asMap ? 'Xem dạng danh sách' : 'Xem trên bản đồ'}
          aria-pressed={asMap}
          title={asMap ? 'Danh sách' : 'Bản đồ'}
        >
          <Icon name={asMap ? 'list' : 'map'} size={18} />
        </button>
        <button className={`btn btn--sm ${filterCount ? 'btn--accent' : 'btn--ghost'}`} onClick={() => setFiltersOpen(true)}>
          <Icon name="sliders" size={16} /> Lọc{filterCount ? ` (${filterCount})` : ''}
        </button>
      </div>

      <section className="discover-a__filters" aria-label="Bộ lọc khám phá">
        <label>Thành phố<input className="input" list="discover-a-cities" value={city} onChange={(e)=>setParams({city:e.target.value})} placeholder="Tất cả thành phố" /></label>
        <datalist id="discover-a-cities">{cities.map((c)=><option value={c} key={c} />)}</datalist>
        {tab === 'tours' ? <label>Ngôn ngữ<select className="input" value={lang} onChange={(e)=>setParams({lang:e.target.value})}><option value="">Tất cả ngôn ngữ</option>{LANGUAGE_OPTIONS.map((o)=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label> : null}
        <label>{tab === 'tours' ? 'Loại tour' : 'Loại địa điểm'}<select className="input" value={type} onChange={(e)=>setParams({type:e.target.value})}><option value="">Tất cả loại</option>{(tab === 'tours' ? TOUR_TYPE_OPTIONS : PLACE_TYPE_OPTIONS).map((o)=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>
        <label>Sắp xếp<select className="input" value={sort} onChange={(e)=>setParams({sort:e.target.value})}>{sortOptions.map((o)=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>
      </section>

      {cities.length ? (
        <div className="sorts discover__cities" role="group" aria-label="Thành phố">
          <button className={`sortchip ${!city ? 'sortchip--on' : ''}`} aria-pressed={!city} onClick={() => setParams({ city: '' })}>
            Mọi nơi
          </button>
          {cities.map((c) => (
            <button key={c} className={`sortchip ${city === c ? 'sortchip--on' : ''}`} aria-pressed={city === c} onClick={() => setParams({ city: city === c ? '' : c })}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error.offline ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div className="banner__text">
            <div className="alert__title">{error.message}</div>
            {error.offline ? 'Kiểm tra kết nối rồi thử lại.' : null}
          </div>
          <button className="btn" onClick={() => { if (error.retryMore) loadMore(error.retryMore); else { setError(null); setRetryKey((n)=>n+1); } }}>Thử lại</button>
        </div>
      ) : null}

      {asMap ? (
        <DiscoverMap
          kind={tab}
          items={tab === 'places' ? results?.items ?? [] : (toursLanding ? popular?.tours : results?.tours) ?? []}
          me={coords}
          onOpenPlace={setDetail}
          onAddPlace={onAddPlace}
        />
      ) : toursLanding ? (
        <>
          {recent.length ? (
            <section className="discover__section" aria-labelledby="recent-h">
              <h2 className="discover__h2" id="recent-h">Nghe tiếp</h2>
              <div className="sorts">
                {recent.map((r) => (
                  <Link key={r.id} className="sortchip discover__recent" to={`/tour/${r.id}`}>
                    <Icon name="headphones" size={14} /> {r.title || 'Tour'}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="discover__section" aria-labelledby="near-h">
            <div className="discover__sectionhead">
              <h2 className="discover__h2" id="near-h">Gần bạn</h2>
              {coords ? (
                <button className="linkbtn" onClick={() => setParams({ sort: 'nearby' })}>Xem tất cả</button>
              ) : null}
            </div>
            {coords ? (
              nearbyError ? (
                <div role="alert"><p>{nearbyError}</p><button className="btn" onClick={() => setRetryKey((n) => n + 1)}>Thử lại tour gần bạn</button></div>
              ) : nearby === null ? (
                <p className="muted small"><Icon name="loader" size={14} className="spin" /> Đang tìm tour quanh bạn…</p>
              ) : nearby.length ? (
                <ul className="hscroll">
                  {nearby.map((t) => <TourCard key={t.id} tour={t} />)}
                </ul>
              ) : (
                <p className="muted small">Chưa có tour nào gần bạn — xem các tour phổ biến bên dưới.</p>
              )
            ) : (
              <div className="card discover__locate">
                <Icon name="crosshair" size={22} />
                <div>
                  <b>Xem tour quanh chỗ bạn đứng</b>
                  <p className="muted small">
                    {geoState === 'denied'
                      ? 'Trình duyệt đang chặn quyền vị trí. Bạn có thể bật lại trong cài đặt trang web.'
                      : 'GeoSound chỉ dùng vị trí để sắp xếp tour gần bạn, không lưu lại.'}
                  </p>
                </div>
                {geoState !== 'denied' && geoState !== 'unsupported' ? (
                  <button className="btn btn--sm" onClick={locate} disabled={geoState === 'asking'}>
                    {geoState === 'asking' ? <Icon name="loader" size={14} className="spin" /> : null} Bật vị trí
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <section className="discover__section" aria-labelledby="pop-h">
            <h2 className="discover__h2" id="pop-h">Phổ biến</h2>
            {popular === null && error ? <p className="muted">Chưa tải được danh sách tour.</p> : popular === null ? (
              <SkeletonList />
            ) : popular.tours.length ? (
              <>
                <ul className="tourlist tourlist--compact">
                  {popular.tours.map((t) => <TourCard key={t.id} tour={t} />)}
                </ul>
                {popular.tours.length < popular.total ? (
                  <button className="btn loadmore" onClick={() => loadMore('popular')} disabled={loadingMore}>
                    {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
                  </button>
                ) : null}
              </>
            ) : (
              <p className="muted">Chưa có tour công khai nào.</p>
            )}
          </section>
        </>
      ) : (
        <section className="discover__section" aria-live="polite">
          <div className="sorts" role="group" aria-label="Sắp xếp">
            {sortOptions.map((o) => (
              <button
                key={o.value}
                className={`sortchip ${sort === o.value ? 'sortchip--on' : ''}`}
                aria-pressed={sort === o.value}
                onClick={() => setParams({ sort: o.value === (tab === 'places' ? 'recent' : 'popular') ? '' : o.value })}
              >
                {o.value === 'nearby' ? (
                  <Icon name={geoState === 'asking' ? 'loader' : 'crosshair'} size={14} className={geoState === 'asking' ? 'spin' : ''} />
                ) : null}
                {o.label}
              </button>
            ))}
          </div>

          {wantNearby && !coords ? (
            <p className="muted">
              {geoState === 'denied' ? 'Chưa có quyền vị trí — hãy cho phép để sắp xếp theo khoảng cách.' : 'Đang lấy vị trí của bạn…'}
            </p>
          ) : error && !results ? <p className="muted">Chưa tải được kết quả. Bộ lọc của bạn vẫn được giữ.</p> : loading || !results ? (
            <SkeletonList />
          ) : tab === 'tours' ? (
            results.tours.length ? (
              <>
                <p className="tours__count">{results.total} tour</p>
                <ul className="tourlist tourlist--compact">
                  {results.tours.map((t) => <TourCard key={t.id} tour={t} />)}
                </ul>
                {results.tours.length < results.total ? (
                  <button className="btn loadmore" onClick={() => loadMore('results')} disabled={loadingMore}>
                    {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
                  </button>
                ) : null}
              </>
            ) : (
              <Empty what="tour" onReset={resetFilters} canReset={!!(q || filterCount)} />
            )
          ) : results.items.length ? (
            <>
              <p className="tours__count">{results.total} địa điểm</p>
              <ul className="explore__list">
                {results.items.map((p) => (
                  <li key={p.placeId} className="place-card">
                    <button className="place-card__open" onClick={() => setDetail(p)} aria-label={`Xem ${p.name}`}>
                      <span className="place-card__thumb" aria-hidden="true">
                        {p.images?.[0]?.url ? <img src={p.images[0].url} alt="" loading="lazy" /> : <Icon name="map-pin" size={22} />}
                      </span>
                      <span className="place-card__body">
                        <span className="place-card__name">{p.name}</span>
                        <span className="place-card__meta">
                          <span className="chip">{PLACE_TYPE_LABELS[p.type] || p.type}</span>
                          {p.city ? <span className="muted small">{p.city}</span> : null}
                          {Number.isFinite(p.distanceMeters) ? <span className="muted small">· {formatDistance(p.distanceMeters)}</span> : null}
                        </span>
                        {p.tourTitle ? <span className="place-card__tour muted small">Từ tour: {p.tourTitle}</span> : null}
                      </span>
                    </button>
                    {addedIds[p.placeId] ? (
                      <span className="place-card__added"><Icon name="check-circle" size={18} /> Đã thêm</span>
                    ) : (
                      <button
                        className="iconbtn place-card__plus"
                        onClick={() => onAddPlace(p)}
                        disabled={addingId === p.placeId}
                        aria-label={`Thêm ${p.name} vào lịch trình`}
                      >
                        <Icon name={addingId === p.placeId ? 'loader' : 'plus'} size={18} className={addingId === p.placeId ? 'spin' : ''} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {results.items.length < results.total ? (
                <button className="btn loadmore" onClick={() => loadMore('results')} disabled={loadingMore}>
                  {loadingMore ? <Icon name="loader" size={16} className="spin" /> : null} Xem thêm
                </button>
              ) : null}
            </>
          ) : (
            <Empty what="địa điểm" onReset={resetFilters} canReset={!!(q || filterCount)} />
          )}
        </section>
      )}

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        tab={tab}
        values={{ city, lang, type }}
        cities={cities}
        onChange={setParams}
        onReset={() => setParams({ city: '', lang: '', type: '' })}
      />
      <PlaceDetailSheet place={detail} onClose={() => setDetail(null)} onAdd={onAddPlace} />
      <AddToItinerarySheet open={!!adding} place={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="tourlist" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="skel-card">
          <div className="skel skel-card__cover" />
          <div className="skel skel-line" style={{ width: '70%' }} />
          <div className="skel skel-line" style={{ width: '45%' }} />
        </li>
      ))}
    </ul>
  );
}

function Empty({ what, onReset, canReset }) {
  return (
    <div className="emptybox tours__empty">
      <Icon name="search" size={40} />
      <h2>Không tìm thấy {what} phù hợp</h2>
      <p>Thử từ khoá khác, bỏ bớt bộ lọc, hoặc dùng “Gần tôi”.</p>
      {canReset ? <button className="btn btn--ghost" onClick={onReset}>Xoá tìm kiếm &amp; bộ lọc</button> : null}
    </div>
  );
}

// Bộ lọc chi tiết trong bottom sheet — áp ngay khi chọn (không cần bấm "Tìm").
function FilterSheet({ open, onClose, tab, values, cities, onChange, onReset }) {
  const typeOptions = tab === 'places' ? PLACE_TYPE_OPTIONS : TOUR_TYPE_OPTIONS;
  return (
    <Modal open={open} onClose={onClose} title="Bộ lọc" labelledBy="filters-title">
      <div className="filtersheet">
        <div className="field">
          <label className="field__label" htmlFor="f-city">Thành phố</label>
          <input
            id="f-city"
            className="input"
            list="f-city-list"
            placeholder="Mọi thành phố"
            value={values.city}
            onChange={(e) => onChange({ city: e.target.value })}
            autoComplete="off"
          />
          <datalist id="f-city-list">
            {cities.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        {tab === 'tours' ? (
          <div className="field">
            <label className="field__label" htmlFor="f-lang">Ngôn ngữ gốc</label>
            <select id="f-lang" className="input" value={values.lang} onChange={(e) => onChange({ lang: e.target.value })}>
              <option value="">Mọi ngôn ngữ</option>
              {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="f-type">{tab === 'places' ? 'Loại địa điểm' : 'Loại tour'}</label>
          <select id="f-type" className="input" value={values.type} onChange={(e) => onChange({ type: e.target.value })}>
            <option value="">Tất cả</option>
            {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="filtersheet__actions">
          <button className="btn btn--ghost" onClick={onReset}>Xoá bộ lọc</button>
          <button className="btn btn--primary" onClick={onClose}>Xem kết quả</button>
        </div>
      </div>
    </Modal>
  );
}
