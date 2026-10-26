// =========================================================
// TourDetailPage (UC02 bước 6–11, A2, E3) — Chi tiết tour CÔNG KHAI.
//   - Ảnh bìa, mô tả, số điểm, thời lượng, điểm đánh giá, nhãn giọng.
//   - Bản đồ route (UC11) ở chế độ xem tĩnh (tái dùng TourMap của UC04).
//   - Chọn ngôn ngữ nghe (A2) → cập nhật nội dung + nhãn giọng.
//   - Hành động: Nghe tour (→ UC04) / Tải offline (UC03, sắp có).
//   - E3: tour không còn khả dụng → thông báo + quay lại danh sách.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { fetchTourDetail } from '../../lib/api.js';
import { langLabel, formatMinutes } from '../../lib/format.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';
import { useTheme } from '../../hooks/useTheme.js';
import Icon from '../../components/Icon.jsx';
import TourMap from '../player/TourMap.jsx';
import Rating from './Rating.jsx';

const BACK = '/tours';

export default function TourDetailPage() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { isDark, toggle } = useTheme();

  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, offline, notFound }
  const [langBusy, setLangBusy] = useState(false);

  const load = useCallback(
    async (useLang, opts) => fetchTourDetail(tourId, useLang, opts),
    [tourId],
  );

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    load(sp.get('lang') || undefined, { signal: abort.signal })
      .then((t) => {
        setTour(t);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return; // huỷ do đổi route/StrictMode — giữ loading, KHÔNG set lỗi
        setError({
          message: e.offline ? 'Mất kết nối mạng' : e.status === 404 ? 'Tour không còn khả dụng' : e.message,
          offline: e.offline,
          notFound: e.status === 404,
        });
        setLoading(false);
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const changeLang = async (code) => {
    if (code === tour?.selectedLanguage || langBusy) return;
    setLangBusy(true);
    try {
      const t = await load(code);
      setTour(t);
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('lang', t.selectedLanguage);
          return n;
        },
        { replace: true },
      );
    } catch {
      /* giữ nội dung cũ nếu lỗi */
    } finally {
      setLangBusy(false);
    }
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
                ? 'Tour có thể đã bị ẩn hoặc gỡ. Hãy quay lại danh sách.'
                : 'Đã có lỗi khi tải tour.'}
          </p>
          <div className="row">
            <button className="btn btn--ghost" onClick={() => navigate(BACK)}>
              <Icon name="arrow-left" size={16} /> Danh sách tour
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

  const langParam = tour.selectedLanguage ? `?lang=${encodeURIComponent(tour.selectedLanguage)}` : '';
  const hasGeo =
    (tour.places || []).some((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ||
    (tour.route?.path?.length ?? 0) > 1;

  return (
    <div className="screen intro">
      {/* Ảnh bìa */}
      <div
        className="intro__cover"
        style={tour.coverImageUrl ? { backgroundImage: `url(${tour.coverImageUrl})` } : undefined}
        role="img"
        aria-label={`Ảnh bìa tour ${tour.title}`}
      >
        <div className="intro__cover-grad" />
        <button className="iconbtn intro__back" onClick={() => navigate(BACK)} aria-label="Quay lại danh sách">
          <Icon name="arrow-left" size={20} />
        </button>
        <button className="iconbtn intro__theme" onClick={toggle} aria-label="Đổi giao diện sáng/tối">
          <Icon name={isDark ? 'sun' : 'moon'} size={18} />
        </button>
      </div>

      <div className="intro__body">
        <h1 className="intro__title">{tour.title}</h1>

        <div className="intro__chips">
          {tour.city ? <span className="chip"><Icon name="map-pin" size={13} /> {tour.city}</span> : null}
          <span className="chip"><Icon name="list" size={13} /> {tour.placeCount} điểm</span>
          {tour.duration ? <span className="chip"><Icon name="clock" size={13} /> {formatMinutes(tour.duration)}</span> : null}
          {tour.type ? <span className="chip">{TOUR_TYPE_LABELS[tour.type] || tour.type}</span> : null}
          <span className="chip"><Icon name="volume" size={13} /> {tour.voiceLabel}</span>
        </div>

        <div className="detail__rating">
          <Rating value={tour.averageRating} count={tour.ratingCount} />
        </div>

        {tour.description ? <p className="intro__desc">{tour.description}</p> : null}

        {/* Chọn ngôn ngữ nghe (A2) */}
        {tour.availableLanguages?.length > 1 ? (
          <section className="detail__section" aria-labelledby="lang-h">
            <h2 className="detail__h2" id="lang-h">Ngôn ngữ nghe</h2>
            <div className="langpick" role="group" aria-label="Chọn ngôn ngữ nghe">
              {tour.availableLanguages.map((code) => {
                const on = code === tour.selectedLanguage;
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
            <p className="detail__voice">
              <Icon name="volume" size={14} /> {tour.voiceLabel} khi nghe bằng {langLabel(tour.selectedLanguage)}.
            </p>
          </section>
        ) : null}

        {/* Bản đồ route (UC11) */}
        {hasGeo ? (
          <section className="detail__section" aria-labelledby="map-h">
            <h2 className="detail__h2" id="map-h">Lộ trình trên bản đồ</h2>
            <div className="detail__map">
              <TourMap tour={tour} />
            </div>
          </section>
        ) : null}

        {/* Các điểm dừng */}
        {tour.places?.length ? (
          <section className="detail__section" aria-labelledby="stops-h">
            <h2 className="detail__h2" id="stops-h">Các điểm dừng</h2>
            <ol className="stops detail__stops">
              {tour.places.map((p, i) => (
                <li key={p.id} className="stop" aria-current={false}>
                  <span className="stop__num">{p.sequence ?? i + 1}</span>
                  <span className="stop__info">
                    <span className="stop__name">{p.name}</span>
                    {p.images?.length ? (
                      <span className="stop__sub"><Icon name="image" size={12} /> {p.images.length} ảnh</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Đánh giá & nhận xét (UC05 — sắp có) */}
        <section className="detail__section" aria-labelledby="rev-h">
          <h2 className="detail__h2" id="rev-h">Đánh giá &amp; nhận xét</h2>
          {tour.ratingCount ? (
            <p className="muted small">
              Điểm trung bình {Number(tour.averageRating).toFixed(1).replace('.', ',')}/5 từ {tour.ratingCount} lượt đánh giá.
            </p>
          ) : (
            <p className="muted small">Chưa có nhận xét. Hãy là người đầu tiên sau khi nghe tour.</p>
          )}
        </section>

        {/* Hành động (bước 10–11) */}
        <div className="detail__actions">
          {tour.places?.length ? (
            <button
              className="btn btn--primary btn--lg btn--block"
              onClick={() => navigate(`/tour/${encodeURIComponent(tour.id)}/play${langParam}`)}
            >
              <Icon name="headphones" size={18} /> Nghe tour
            </button>
          ) : (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>Tour này chưa có điểm nào để nghe.</div>
            </div>
          )}
          <button className="btn btn--lg btn--block" disabled title="Tính năng tải offline đang được phát triển (UC03)">
            <Icon name="download" size={18} /> Tải để nghe offline (sắp có)
          </button>
        </div>
      </div>
    </div>
  );
}
