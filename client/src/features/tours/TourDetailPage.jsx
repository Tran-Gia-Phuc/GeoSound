// =========================================================
// TourDetailPage (UC02 bước 6–11, A2, E3) — Chi tiết tour CÔNG KHAI.
//   - Ảnh bìa, mô tả, số điểm, thời lượng, điểm đánh giá, nhãn giọng.
//   - Bản đồ route (UC11) ở chế độ xem tĩnh (tái dùng TourMap của UC04).
//   - Chọn ngôn ngữ nghe (A2) → cập nhật nội dung + nhãn giọng (đặt gần hành động).
//   - Mỗi điểm: chạm → nghe tại điểm đó; ▶ nghe thử ngay; ＋ thêm vào lịch trình.
//   - Thanh hành động DÍNH ĐÁY: [Nghe thử] [Bắt đầu đi tour] → trình phát mở
//     thẳng theo ?mode= (không còn màn intro thứ hai). Tải offline (UC03) ẩn.
//   - E3: tour không còn khả dụng → thông báo + quay lại danh sách.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { fetchTourDetail } from '../../lib/api.js';
import { langLabel, formatMinutes, voiceLabel } from '../../lib/format.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';
import { useBack } from '../../components/shell/AppHeader.jsx';
import Icon from '../../components/Icon.jsx';
import TourMap from '../player/TourMap.jsx';
import Rating from './Rating.jsx';
import ModePicker from '../player/ModePicker.jsx';
import AddToItinerarySheet from '../itineraries/AddToItinerarySheet.jsx';
import { playPreview, stopPreview } from '../../lib/preview-audio.js';
import { usePendingAdd } from '../../hooks/usePendingAdd.js';

// Mở thẳng bằng link chia sẻ (không có lịch sử) → về Khám phá.
import './detail-a.css';

const BACK = '/';

export default function TourDetailPage() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const back = useBack(BACK);

  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, offline, notFound }
  const [langBusy, setLangBusy] = useState(false);
  const [languageError, setLanguageError] = useState(null);
  const [langRetry, setLangRetry] = useState(0);
  const requestedLanguage = sp.get('lang') || '';
  const loadedTour = useRef(null);
  const [previewing, setPreviewing] = useState(null); // id điểm đang nghe thử
  const [adding, setAdding] = useState(null); // { placeId, name } cho sheet "Thêm vào…"

  useEffect(() => () => stopPreview(), []);

  // Vừa đăng nhập xong để thêm một điểm → mở lại sheet "Thêm vào…".
  const [pendingAdd, clearPendingAdd] = usePendingAdd();
  useEffect(() => {
    if (!pendingAdd) return;
    setAdding(pendingAdd);
    clearPendingAdd();
  }, [pendingAdd, clearPendingAdd]);

  const load = useCallback(
    async (useLang, opts) => fetchTourDetail(tourId, useLang, opts),
    [tourId],
  );

  useEffect(() => {
    const abort = new AbortController();
    const hasPrevious = loadedTour.current?.id === tourId;
    setLoading(!hasPrevious); setLangBusy(hasPrevious); setError(null); setLanguageError(null);
    load(requestedLanguage || undefined, { signal:abort.signal })
      .then((result) => { if (!abort.signal.aborted) { loadedTour.current=result; setTour(result); } })
      .catch((e) => {
        if (abort.signal.aborted || e.name === 'AbortError') return;
        if (hasPrevious && e.status !== 404) setLanguageError({ requested:requestedLanguage, message:e.message || 'Không đổi được ngôn ngữ. Nội dung trước vẫn được giữ.' });
        else setError({ message:e.offline ? 'Mất kết nối mạng' : e.status === 404 ? 'Tour không còn khả dụng' : e.message, offline:e.offline, notFound:e.status === 404 });
      })
      .finally(() => { if (!abort.signal.aborted) { setLoading(false); setLangBusy(false); } });
    return () => abort.abort();
  }, [tourId, requestedLanguage, langRetry, load]);

  const changeLang = (code) => {
    if (langBusy || code === tour?.selectedLanguage) return;
    stopPreview();setPreviewing(null);
    setSp((prev) => { const n=new URLSearchParams(prev);n.set('lang',code);return n; });
  };

  // ---------- Tải / lỗi ----------
  if (loading) {
    return (
      <div className="screen screen--center">
        <Icon name="loader" size={36} className="spin" />
        <p className="muted">Đang tải tour…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="screen screen--center">
        <div className="emptybox">
          <Icon name={error.offline ? 'wifi-off' : 'alert-triangle'} size={40} />
          <h2>{error.message}</h2>
          <p className="muted">
            {error.offline
              ? 'Hãy kiểm tra kết nối mạng rồi thử lại.'
              : error.notFound
                ? 'Tour có thể đã bị ẩn hoặc gỡ. Hãy tìm tour khác ở Khám phá.'
                : 'Đã có lỗi khi tải tour.'}
          </p>
          <div className="row">
            <button className="btn btn--ghost" onClick={() => navigate(BACK)}>
              <Icon name="arrow-left" size={16} /> Về Khám phá
            </button>
            {!error.notFound ? (
              <button className="btn btn--primary" onClick={() => window.location.reload()}>Thử lại</button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!tour) return null; // phòng hờ: không loading, không lỗi, nhưng chưa có dữ liệu (tránh crash null)

  const lang = tour.selectedLanguage;
  const playUrl = (mode, stop) => {
    const p = new URLSearchParams({ mode });
    if (lang) p.set('lang', lang);
    if (stop) p.set('stop', stop);
    return `/tour/${encodeURIComponent(tour.id)}/play?${p.toString()}`;
  };
  const hasGeo =
    (tour.places || []).some((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ||
    (tour.route?.path?.length ?? 0) > 1;
  const hasPlaces = (tour.places?.length ?? 0) > 0;

  const togglePreview = (p) => {
    if (previewing === p.id) {
      stopPreview();
      setPreviewing(null);
      return;
    }
    setPreviewing(p.id);
    playPreview({ url: p.audioUrl, text: p.text, lang, onEnd: () => setPreviewing(null) });
  };

  return (
    <div className={`screen intro detail-a ${hasPlaces ? 'detail--withbar' : ''}`}>
      <div className="detail-a__overview">
      {/* Ảnh bìa */}
      <div
        className="intro__cover"
        style={tour.coverImageUrl ? { backgroundImage: `url(${tour.coverImageUrl})` } : undefined}
        role="img"
        aria-label={`Ảnh bìa tour ${tour.title}`}
      >
        <div className="intro__cover-grad" />
        <button className="iconbtn intro__back" onClick={back} aria-label="Quay lại">
          <Icon name="arrow-left" size={20} />
        </button>
      </div>

      <div className="intro__body">
        <h1 className="intro__title">{tour.title}</h1>

        <div className="intro__chips">
          {tour.city ? <span className="chip"><Icon name="map-pin" size={13} /> {tour.city}</span> : null}
          <span className="chip"><Icon name="list" size={13} /> {tour.placeCount} điểm</span>
          {tour.duration ? <span className="chip"><Icon name="clock" size={13} /> {formatMinutes(tour.duration)}</span> : null}
          {tour.type ? <span className="chip">{TOUR_TYPE_LABELS[tour.type] || tour.type}</span> : null}
        </div>

        <div className="detail__rating">
          <Rating value={tour.averageRating} count={tour.ratingCount} />
          <span className="muted small"><Icon name="volume" size={13} /> {voiceLabel(tour.voiceLabel)}</span>
        </div>

        {languageError ? <div className="alert alert--warn" role="alert"><Icon name="alert-triangle" size={18} /><div><b>Chưa đổi được ngôn ngữ</b><p>{languageError.message}</p><p>Đang hiển thị {langLabel(tour.selectedLanguage)}.</p><button className="btn btn--sm" onClick={()=>setLangRetry((n)=>n+1)}>Thử lại ngôn ngữ</button><button className="btn btn--ghost btn--sm" onClick={()=>setSp((prev)=>{const n=new URLSearchParams(prev);n.set('lang',tour.selectedLanguage);return n;})}>Giữ ngôn ngữ hiện tại</button></div></div> : null}
        {/* Chọn ngôn ngữ nghe (A2) — đặt gần nút hành động */}
        {tour.availableLanguages?.length > 1 ? (
          <div className="langpick" role="group" aria-label="Ngôn ngữ nghe">
            {tour.availableLanguages.map((code) => {
              const on = code === lang;
              return (
                <button
                  key={code}
                  type="button"
                  className={`langchip ${on ? 'langchip--on' : ''}`}
                  aria-pressed={on}
                  disabled={langBusy}
                  onClick={() => changeLang(code)}
                >
                  {langLabel(code)}
                </button>
              );
            })}
            {langBusy ? <Icon name="loader" size={16} className="spin" /> : null}
          </div>
        ) : null}

        {tour.description ? <p className="intro__desc">{tour.description}</p> : null}

        {/* Đánh giá: chỉ điểm trung bình cho tới khi có UC05 */}
        {tour.ratingCount ? (
          <section className="detail__section" aria-labelledby="rev-h">
            <h2 className="detail__h2" id="rev-h">Đánh giá</h2>
            <p className="muted small">
              Điểm trung bình {Number(tour.averageRating).toFixed(1).replace('.', ',')}/5 từ {tour.ratingCount} lượt đánh giá.
            </p>
          </section>
        ) : null}
      </div>

      </div>
      <aside className="detail-a__route" aria-label="Lộ trình và điểm dừng">
        {/* Bản đồ route (UC11) */}
        {hasGeo ? (
          <section className="detail__section" aria-labelledby="map-h">
            <h2 className="detail__h2" id="map-h">Lộ trình trên bản đồ</h2>
            <div className="detail__map">
              <TourMap tour={tour} />
            </div>
          </section>
        ) : null}

        {/* Các điểm dừng: ▶ nghe thử điểm · ＋ thêm vào lịch trình */}
        {hasPlaces ? (
          <section className="detail__section" aria-labelledby="stops-h">
            <h2 className="detail__h2" id="stops-h">Các điểm dừng</h2>
            <ol className="stops detail__stops">
              {tour.places.map((p, i) => (
                <li key={p.id} className="stop detail-stop">
                  <span className="stop__num">{i + 1}</span>
                  {p.images?.[0]?.url ? <img className="detail-a__stopimage" src={p.images[0].url} alt="" loading="lazy" /> : null}
                  <Link className="stop__info detail-stop__open" to={playUrl('remote', p.id)}>
                    <span className="stop__name">{p.name}</span>
                    <span className="stop__sub">
                      {p.images?.length ? <><Icon name="image" size={12} /> {p.images.length} ảnh · </> : null}
                      Nghe tại điểm này
                    </span>
                  </Link>
                  <button
                    className="iconbtn iconbtn--sm"
                    onClick={() => togglePreview(p)}
                    aria-label={previewing === p.id ? `Dừng nghe ${p.name}` : `Nghe thử ${p.name}`}
                    aria-pressed={previewing === p.id}
                  >
                    <Icon name={previewing === p.id ? 'pause' : 'play'} size={16} />
                  </button>
                  <button
                    className="iconbtn iconbtn--sm"
                    onClick={() => setAdding({ placeId: p.id, name: p.name })}
                    aria-label={`Thêm ${p.name} vào lịch trình`}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>Tour này chưa có điểm nào để nghe.</div>
          </div>
        )}

      </aside>

      {/* Thanh hành động dính đáy — luôn nhìn thấy (bước 10–11) */}
      {hasPlaces ? (
        <div className="detail__bar">
          <ModePicker to={(mode) => playUrl(mode)} />
        </div>
      ) : null}

      <AddToItinerarySheet open={!!adding} place={adding} onClose={() => setAdding(null)} />
    </div>
  );
}
