// =========================================================
// TourStatsPage (/studio/tours/:id/stats) - UC17 "Thống kê tour" for the author (#271, #117).
//   - Filters in the URL: ?period=7|30|90|custom (&from&to for custom) &language=xx.
//   - Tiles: views, plays, completions, completion rate, downloads.
//   - Daily chart: one series (metric picked with a toggle), one bar per day of the period
//     (days without data are zero), scrolls inside its frame on a phone; table view below.
//   - Ratings (average, count, star distribution) and the latest comments.
//   - E1: everything zero -> "Chưa có dữ liệu thống kê". 403 -> message; other errors -> "Thử lại".
// =========================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useStudioTour } from './StudioTourLayout.jsx';
import { getTourStats } from '../../lib/tour-stats.js';
import { getLanguageConfig } from '../../lib/studio.js';
import { formatDateTime, langLabel } from '../../lib/format.js';
import '../tours/ratings.css';
import './tour-stats.css';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const PERIODS = [
  { value: '7', label: '7 ngày' },
  { value: '30', label: '30 ngày' },
  { value: '90', label: '90 ngày' },
  { value: 'custom', label: 'Tuỳ chọn' },
];
const METRICS = [
  { key: 'views', label: 'Lượt xem', unit: 'lượt xem' },
  { key: 'plays', label: 'Lượt nghe', unit: 'lượt nghe' },
  { key: 'completions', label: 'Hoàn thành', unit: 'lượt hoàn thành' },
  { key: 'downloads', label: 'Tải về', unit: 'lượt tải' },
];
const DAY = 86400000;
const MAX_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fullDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const num = (v) => (Number(v) || 0).toLocaleString('vi-VN');
const percent = (r) => `${(Math.round((Number(r) || 0) * 1000) / 10).toLocaleString('vi-VN')}%`;
const formatAverage = (v) => (Number(v) || 0).toFixed(1).replace('.', ',');

/** URL filters -> API query { from, to, language } plus a client-side error. */
function readFilters(sp) {
  const period = PERIODS.some((p) => p.value === sp.get('period')) ? sp.get('period') : '30';
  const language = sp.get('language') || '';
  if (period !== 'custom') {
    const to = isoDay(Date.now());
    return { period, language, from: isoDay(dayMs(to) - (Number(period) - 1) * DAY), to, error: null };
  }
  const from = ISO_DAY.test(sp.get('from') || '') ? sp.get('from') : '';
  const to = ISO_DAY.test(sp.get('to') || '') ? sp.get('to') : '';
  let error = null;
  if (!from || !to) error = 'Chọn ngày bắt đầu và ngày kết thúc';
  else if (from > to) error = 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc';
  else if ((dayMs(to) - dayMs(from)) / DAY + 1 > MAX_DAYS) error = `Khoảng thời gian tối đa ${MAX_DAYS} ngày`;
  return { period, language, from, to, error };
}

/** Every day of [from, to] with the API values (days without data are 0). */
function fillDays(from, to, daily) {
  const byDay = new Map((daily || []).map((d) => [d.day, d]));
  const out = [];
  for (let t = dayMs(from); t <= dayMs(to) && out.length < MAX_DAYS; t += DAY) {
    const day = isoDay(t);
    const d = byDay.get(day) || {};
    out.push({ day, views: d.views || 0, plays: d.plays || 0, completions: d.completions || 0, downloads: d.downloads || 0 });
  }
  return out;
}

function Tile({ label, value, testId }) {
  return (
    <div className="card admin-stat" data-testid={testId}>
      <span className="muted small">{label}</span>
      <b className="admin-stat__value">{value}</b>
    </div>
  );
}

function DailyChart({ days, metric }) {
  const m = METRICS.find((x) => x.key === metric) || METRICS[0];
  const max = Math.max(0, ...days.map((d) => d[m.key]));
  return (
    <figure className="stats-chart" aria-labelledby="stats-chart-title">
      <figcaption id="stats-chart-title" className="stats-chart__title">
        {m.label} theo ngày <span className="muted small">(cao nhất {num(max)})</span>
      </figcaption>
      <div className="stats-chart__scroll">
        <ol className="stats-chart__bars" style={{ '--n': days.length }}>
          {days.map((d, i) => {
            const v = d[m.key];
            const showDay = days.length <= 14 || i % 7 === 0 || i === days.length - 1;
            const h = max ? Math.max(v ? 4 : 0, Math.round((v / max) * 100)) : 0;
            const label = `${fullDay(d.day)}: ${num(v)} ${m.unit}`;
            return (
              <li key={d.day} className="stats-chart__col" title={label} aria-label={label} tabIndex={0} data-testid="stats-bar">
                <span className="stats-chart__track" aria-hidden="true">
                  <span className="stats-chart__bar" style={{ height: `${h}%` }} />
                </span>
                <span className="stats-chart__day" aria-hidden="true">{showDay ? shortDay(d.day) : ''}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </figure>
  );
}

function DailyTable({ days }) {
  const rows = days.filter((d) => d.views || d.plays || d.completions || d.downloads);
  return (
    <details className="stats-table">
      <summary>Xem dạng bảng</summary>
      <div className="admin-table__wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Ngày</th>
              {METRICS.map((m) => <th key={m.key} scope="col">{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.day}>
                <th scope="row">{fullDay(d.day)}</th>
                {METRICS.map((m) => <td key={m.key}>{num(d[m.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function RatingsBlock({ ratings, comments }) {
  const dist = ratings?.distribution || {};
  const rows = [1, 2, 3, 4, 5].reduce((s, n) => s + (Number(dist[n]) || 0), 0);
  const items = comments?.items || [];
  return (
    <section className="card stats-ratings" aria-labelledby="stats-ratings-h">
      <h2 className="detail__h2" id="stats-ratings-h">Đánh giá và nhận xét</h2>
      {ratings?.ratingCount ? (
        <div className="rv-summary" data-testid="stats-rating">
          <div className="rv-summary__avg">
            <b className="rv-summary__value">{formatAverage(ratings.averageRating)}</b>
            <span className="muted small">{num(ratings.ratingCount)} lượt đánh giá</span>
          </div>
          <ul className="rv-dist" aria-label="Phân bố số sao">
            {[5, 4, 3, 2, 1].map((n) => {
              const c = Number(dist[n]) || 0;
              return (
                <li key={n} className="rv-dist__row" aria-label={`${n} sao: ${c} lượt`}>
                  <span className="rv-dist__label" aria-hidden="true">{n}<Icon name="star" size={11} className="rv-star rv-star--on" /></span>
                  <span className="rv-dist__bar" aria-hidden="true"><span style={{ width: `${rows ? Math.round((c / rows) * 100) : 0}%` }} /></span>
                  <span className="rv-dist__count muted small" aria-hidden="true">{c}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="muted small">Chưa có đánh giá.</p>
      )}

      <h3 className="stats-ratings__h3">Nhận xét mới nhất {comments?.total ? <span className="muted small">({num(comments.total)})</span> : null}</h3>
      {items.length ? (
        <ul className="rv-list" aria-label="Nhận xét mới nhất">
          {items.map((c) => (
            <li key={c.id} className="rv-item" data-testid="stats-comment">
              <div className="rv-item__head">
                <b className="rv-item__name">{c.userName || 'Người dùng GeoSound'}</b>
                <span className="small" aria-label={`${c.stars} trên 5 sao`}>
                  <Icon name="star" size={12} className="rv-star rv-star--on" /> {c.stars}/5
                </span>
              </div>
              <span className="muted small"><time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time></span>
              {c.comment ? <p className="rv-item__text">{c.comment}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Chưa có nhận xét.</p>
      )}
    </section>
  );
}

export default function TourStatsPage() {
  const { tour } = useStudioTour();
  const tourId = tour.id;
  const [sp, setSp] = useSearchParams();
  const filters = readFilters(sp);
  const { period, language, from, to, error: filterError } = filters;
  const [metric, setMetric] = useState('views');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null); // { message, forbidden }
  const [loading, setLoading] = useState(true);
  const [languages, setLanguages] = useState(() => (tour.originalLanguage ? [tour.originalLanguage] : []));

  useEffect(() => {
    let alive = true;
    getLanguageConfig(tourId)
      .then((cfg) => {
        const codes = (cfg?.languages || []).map((l) => l.languageCode).filter(Boolean);
        if (alive && codes.length) setLanguages(codes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tourId]);

  const load = useCallback(
    async (signal) => {
      if (filterError) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const body = await getTourStats(tourId, { from, to, language: language || undefined }, { signal });
        if (!signal?.aborted) setData(body);
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return;
        setError({
          forbidden: e?.status === 403,
          message: e?.offline
            ? OFFLINE_MESSAGE
            : e?.status === 403
              ? e.message || 'Bạn không có quyền xem thống kê tour này'
              : e?.message || 'Chưa tải được thống kê',
        });
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tourId, from, to, language, filterError],
  );

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [load]);

  const setParam = (changes) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );

  const onPeriod = (value) => {
    if (value === 'custom') setParam({ period: 'custom', from: sp.get('from') || from, to: sp.get('to') || to });
    else setParam({ period: value, from: '', to: '' });
  };

  const days = useMemo(() => (data && !filterError ? fillDays(data.from || from, data.to || to, data.daily) : []), [data, from, to, filterError]);
  const totals = data?.totals || {};
  const empty = data && !totals.views && !totals.plays && !totals.completions && !totals.downloads;

  return (
    <div className="stats" aria-busy={loading || undefined}>
      <div className="stats-filters card" role="group" aria-label="Bộ lọc thống kê">
        <div className="stats-filters__periods" role="group" aria-label="Khoảng thời gian">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`langchip ${period === p.value ? 'langchip--on' : ''}`}
              aria-pressed={period === p.value}
              onClick={() => onPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <div className="stats-filters__range">
            <label className="field">
              <span className="field__label">Từ ngày</span>
              <input className="input" type="date" value={sp.get('from') || ''} max={isoDay(Date.now())} onChange={(e) => setParam({ from: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Đến ngày</span>
              <input className="input" type="date" value={sp.get('to') || ''} max={isoDay(Date.now())} onChange={(e) => setParam({ to: e.target.value })} />
            </label>
          </div>
        ) : null}
        <label className="field stats-filters__lang">
          <span className="field__label">Ngôn ngữ</span>
          <select className="input" value={language} onChange={(e) => setParam({ language: e.target.value })}>
            <option value="">Tất cả ngôn ngữ</option>
            {languages.map((code) => (
              <option key={code} value={code}>{langLabel(code)}</option>
            ))}
          </select>
        </label>
        {!filterError ? <p className="muted small stats-filters__range-text">Từ {fullDay(from)} đến {fullDay(to)} (giờ UTC)</p> : null}
      </div>

      {filterError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{filterError}</div>
        </div>
      ) : error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error.message}</div>
          {error.forbidden ? null : <button className="btn btn--sm" onClick={() => load()}>Thử lại</button>}
        </div>
      ) : !data ? (
        <p className="muted"><Icon name="loader" size={18} className="spin" /> Đang tải thống kê…</p>
      ) : (
        <>
          {empty ? (
            <div className="emptybox stats-empty">
              <Icon name="chart" size={36} />
              <h2>Chưa có dữ liệu thống kê</h2>
              <p className="muted">Khi người nghe mở, nghe hoặc tải tour trong khoảng thời gian này, số liệu sẽ hiện ở đây.</p>
            </div>
          ) : (
            <>
              <div className="admin-stats stats-tiles">
                <Tile testId="tile-views" label="Lượt xem" value={num(totals.views)} />
                <Tile testId="tile-plays" label="Lượt nghe" value={num(totals.plays)} />
                <Tile testId="tile-completions" label="Hoàn thành" value={num(totals.completions)} />
                <Tile testId="tile-rate" label="Tỉ lệ hoàn thành" value={percent(totals.completionRate)} />
                <Tile testId="tile-downloads" label="Tải về" value={num(totals.downloads)} />
              </div>
              <section className="card stats-daily" aria-label="Biểu đồ theo ngày">
                <div className="stats-metrics" role="group" aria-label="Chỉ số trên biểu đồ">
                  {METRICS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`langchip ${metric === m.key ? 'langchip--on' : ''}`}
                      aria-pressed={metric === m.key}
                      onClick={() => setMetric(m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <DailyChart days={days} metric={metric} />
                <DailyTable days={days} />
              </section>
            </>
          )}
          <RatingsBlock ratings={data.ratings} comments={data.comments} />
        </>
      )}
    </div>
  );
}
