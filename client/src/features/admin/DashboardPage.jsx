// =========================================================
// DashboardPage (/admin/dashboard) — UC22 moderation dashboard.
//   - Period in the URL: ?period=7 (default, backend default window), ?period=30, or
//     ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (UTC days, `to` included, max 366 days).
//   - Tiles: tours waiting for review (now, link to the UC19 queue), average review time, reported tours in the period,
//     tours with open reports now (link to the UC20 queue).
//   - Top contributors (name + avatar from the public author API, short id fallback, link to the
//     UC21 account page) and admin actions by type as CSS bars.
//   - No data (E1): zeros and "Chưa có dữ liệu", never an empty chart.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { adminErrorMessage } from './admin-errors.js';
import { getDashboard, periodError, presetPeriod } from '../../lib/admin-dashboard.js';
import { actionLabel } from '../../lib/admin-reports.js';
import { getAuthor } from '../../lib/authors.js';
import AuthorAvatar from '../authors/AuthorAvatar.jsx';

const NO_DATA = 'Chưa có dữ liệu';
const PERIODS = [
  { value: '7', label: '7 ngày' },
  { value: '30', label: '30 ngày' },
  { value: 'custom', label: 'Tuỳ chọn' },
];

const shortId = (id) => String(id || '').slice(0, 8);

/**
 * Public profiles of the given author ids (#299): one GET /api/auth/authors/:id per id for the
 * life of the page, all in parallel, never blocking the render. A failed call (404 for a
 * non-contributor or banned author, network error) is kept as null so the row shows the short id.
 * Returns { [id]: author | null } with only the settled ids.
 */
function useAuthors(ids) {
  const requested = useRef(new Set());
  const [authors, setAuthors] = useState({});
  const key = ids.join(',');
  useEffect(() => {
    for (const id of key ? key.split(',') : []) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      getAuthor(id)
        .then((a) => (a && a.fullName ? a : null))
        .catch(() => null)
        .then((a) => setAuthors((m) => ({ ...m, [id]: a })));
    }
  }, [key]);
  return authors;
}

function ContributorCell({ id, author }) {
  const name = author?.fullName;
  return (
    <Link to={`/admin/users/${encodeURIComponent(id)}`} className="admin-author" title={id}>
      <AuthorAvatar key={author?.avatarUrl || 'none'} name={name || '?'} url={author?.avatarUrl} size={28} />
      <span className="admin-author__name" data-testid="contributor-name">
        {name || shortId(id)}
      </span>
    </Link>
  );
}

const fmtNumber = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/** Period of the response, shown as whole days (`to` is the exclusive end). */
function periodText(from, to) {
  const a = new Date(from);
  const b = new Date(new Date(to).getTime() - 1);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return '';
  const day = (d) => d.toLocaleDateString('vi-VN', { timeZone: 'UTC' });
  return `Từ ${day(a)} đến ${day(b)}`;
}

function Tile({ label, value, hint, to, testId }) {
  const body = (
    <>
      <span className="muted small">{label}</span>
      <b className="admin-stat__value">{value}</b>
      {hint ? <span className="muted small">{hint}</span> : null}
    </>
  );
  return to ? (
    <Link className="card admin-stat admin-stat--link" to={to} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="card admin-stat" data-testid={testId}>
      {body}
    </div>
  );
}

/** Horizontal bars, one series: label, bar scaled to the largest value, value as text. */
function ActionBars({ counts }) {
  const rows = Object.entries(counts || {})
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <p className="muted small">{NO_DATA}</p>;
  const max = Math.max(...rows.map(([, n]) => n));
  return (
    <ul className="admin-bars" aria-label="Số hành động theo loại">
      {rows.map(([action, n]) => (
        <li key={action} className="admin-bars__row" data-testid="action-bar" title={`${actionLabel(action)}: ${n}`}>
          <span className="admin-bars__label">{actionLabel(action)}</span>
          <span className="admin-bars__track" aria-hidden="true">
            <span className="admin-bars__fill" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
          </span>
          <span className="admin-bars__value">{fmtNumber(n)}</span>
        </li>
      ))}
    </ul>
  );
}

function Dashboard() {
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : '7';
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  const [draft, setDraft] = useState({ from, to });
  const [draftError, setDraftError] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => setDraft({ from, to }), [from, to]);

  // The API query of the current URL: 7 days -> backend default; custom without valid dates -> none.
  const customInvalid = period === 'custom' && periodError(from, to);
  const load = useCallback(async () => {
    if (customInvalid) return;
    setError(null);
    setData(null);
    try {
      const q = period === '30' ? presetPeriod(30) : period === 'custom' ? { from, to } : {};
      setData(await getDashboard(q));
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được số liệu'));
    }
  }, [period, from, to, customInvalid]);

  useEffect(() => {
    load();
  }, [load]);

  function choose(value) {
    setDraftError(null);
    if (value === 'custom') {
      const p = presetPeriod(7);
      setParams({ period: 'custom', from: from || p.from, to: to || p.to });
    } else setParams(value === '7' ? {} : { period: value });
  }

  function applyCustom(e) {
    e.preventDefault();
    const err = periodError(draft.from, draft.to);
    setDraftError(err);
    if (!err) setParams({ period: 'custom', from: draft.from, to: draft.to });
  }

  const pending = data?.pendingReview || {};
  const hours = Number(data?.averageReviewHours || 0);
  const top = data?.topContributors || [];
  const authors = useAuthors(top.map((c) => c.authorId).filter(Boolean));

  return (
    <div className="page admin-page admin-dashboard">
      <AppHeader title="Dashboard" backTo="/admin" />
      <AdminNav />

      <section className="card admin-filters" aria-label="Khoảng thời gian">
        <div className="segmented" role="radiogroup" aria-label="Khoảng thời gian">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={period === p.value}
              className={`segmented__item ${period === p.value ? 'is-active' : ''}`}
              onClick={() => choose(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <form className="admin-filters__row admin-filters__dates" onSubmit={applyCustom} noValidate>
            <label className="field">
              <span className="field__label">Từ ngày</span>
              <input className="input" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            </label>
            <label className="field">
              <span className="field__label">Đến ngày</span>
              <input className="input" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </label>
            <button className="btn btn--primary btn--sm" type="submit">Áp dụng</button>
            {draftError || customInvalid ? (
              <span className="field__err" role="alert">{draftError || customInvalid}</span>
            ) : null}
          </form>
        ) : null}
        {data ? <span className="muted small" data-testid="period-text">{periodText(data.from, data.to)} (giờ UTC)</span> : null}
      </section>

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {data === null ? (
        error || customInvalid ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : (
        <>
          <div className="admin-stats" aria-label="Tổng quan kiểm duyệt">
            <Tile
              testId="tile-pending"
              label="Tour chờ duyệt (hiện tại)"
              value={fmtNumber(pending.total)}
              hint={`${fmtNumber(pending.pending_review)} chờ duyệt · ${fmtNumber(pending.ai_warning)} cảnh báo AI`}
              to="/admin/reviews"
            />
            <Tile
              testId="tile-review-time"
              label="Thời gian duyệt trung bình"
              value={hours > 0 ? `${fmtNumber(hours)} giờ` : NO_DATA}
            />
            <Tile testId="tile-reported" label="Tour bị báo cáo trong kỳ" value={fmtNumber(data.reportedTours)} />
            <Tile
              testId="tile-open-reports"
              label="Tour đang có báo cáo"
              value={fmtNumber(data.openReportTours)}
              hint="Xem danh sách"
              to="/admin/reports"
            />
          </div>

          <div className="admin-dashboard__grid">
            <section className="card" aria-label="Tác giả nổi bật">
              <h2 className="section-title">Tác giả nổi bật</h2>
              <p className="muted small">Nhiều tour công khai được đánh giá từ 4 sao, không có tour bị ẩn trong kỳ.</p>
              {top.length === 0 ? (
                <p className="muted small">{NO_DATA}</p>
              ) : (
                <div className="admin-table__wrap">
                  <table className="admin-table admin-table--top" aria-label="Tác giả nổi bật">
                    <thead>
                      <tr>
                        <th scope="col">Tác giả</th>
                        <th scope="col">Tour công khai</th>
                        <th scope="col">Đánh giá TB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map((c) => (
                        <tr key={c.authorId} data-testid="top-contributor">
                          <td>
                            <ContributorCell id={c.authorId} author={authors[c.authorId]} />
                          </td>
                          <td>{fmtNumber(c.publicTours)}</td>
                          <td>★ {Number(c.averageRating || 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card" aria-label="Hành động quản trị theo loại">
              <h2 className="section-title">Hành động quản trị theo loại</h2>
              <ActionBars counts={data.actionsByType} />
              <Link className="btn btn--ghost btn--sm admin-dashboard__more" to="/admin/actions">
                Xem nhật ký hành động
              </Link>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AdminGate title="Dashboard">
      <Dashboard />
    </AdminGate>
  );
}
