// =========================================================
// ActionLogPage (/admin/actions) — UC22 read-only log of admin actions (newest first).
//   - Filters in the URL: action, targetType (tour | user), adminId, from, to (YYYY-MM-DD), page.
//   - Row: time, action, target (UC20 dossier for tours, UC21 account page for users), admin, reason.
//   - Loading / empty / error with retry; paging.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { adminErrorMessage } from './admin-errors.js';
import { LOG_LIMIT, TARGET_TYPE_LABELS, listAdminActions } from '../../lib/admin-dashboard.js';
import { ADMIN_ACTION_LABELS, actionLabel } from '../../lib/admin-reports.js';
import { formatDateTime } from '../../lib/format.js';

const FILTER_KEYS = ['action', 'targetType', 'adminId', 'from', 'to'];

/** Link to the target of a log row: tour -> UC20 dossier, user -> UC21 account page. */
export function targetHref(type, id) {
  if (!id) return null;
  if (type === 'tour') return `/admin/reports/${encodeURIComponent(id)}`;
  if (type === 'user') return `/admin/users/${encodeURIComponent(id)}`;
  return null;
}

export function TargetLink({ type, id }) {
  const href = targetHref(type, id);
  const label = `${TARGET_TYPE_LABELS[type] || type} ${id}`;
  return href ? <Link to={href} className="admin-table__sub">{label}</Link> : <span className="admin-table__sub">{label}</span>;
}

function ActionLog() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const key = params.toString();

  const [draft, setDraft] = useState(filters);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(filters), [key]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await listAdminActions({ ...filters, page, limit: LOG_LIMIT }));
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được nhật ký'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  function apply(next, nextPage = 1) {
    const sp = {};
    for (const k of FILTER_KEYS) if ((next[k] || '').trim()) sp[k] = next[k].trim();
    if (nextPage > 1) sp.page = String(nextPage);
    setParams(sp);
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.limit || LOG_LIMIT)));
  const filtered = FILTER_KEYS.some((k) => filters[k]);
  const badPeriod = draft.from && draft.to && draft.from > draft.to;

  return (
    <div className="page admin-page">
      <AppHeader title="Nhật ký hành động" backTo="/admin" />
      <AdminNav />

      <form
        className="card admin-filters"
        aria-label="Lọc nhật ký"
        onSubmit={(e) => {
          e.preventDefault();
          if (!badPeriod) apply(draft);
        }}
        noValidate
      >
        <div className="admin-filters__grid">
          <label className="field">
            <span className="field__label">Loại hành động</span>
            <select className="input" value={draft.action} onChange={set('action')}>
              <option value="">Tất cả hành động</option>
              {Object.entries(ADMIN_ACTION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Đối tượng</span>
            <select className="input" value={draft.targetType} onChange={set('targetType')}>
              <option value="">Tất cả đối tượng</option>
              {Object.entries(TARGET_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Mã quản trị viên</span>
            <input className="input" value={draft.adminId} maxLength={100} onChange={set('adminId')} placeholder="Mã admin" />
          </label>
          <label className="field">
            <span className="field__label">Từ ngày</span>
            <input className="input" type="date" value={draft.from} onChange={set('from')} />
          </label>
          <label className="field">
            <span className="field__label">Đến ngày</span>
            <input className="input" type="date" value={draft.to} onChange={set('to')} />
          </label>
        </div>
        {badPeriod ? <span className="field__err" role="alert">Ngày bắt đầu phải trước ngày kết thúc</span> : null}
        <div className="row admin-filters__actions">
          <button className="btn btn--primary btn--sm" type="submit">
            <Icon name="search" size={16} /> Lọc
          </button>
          {filtered ? (
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => apply({})}>
              Xoá bộ lọc
            </button>
          ) : null}
        </div>
      </form>

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {data === null ? (
        error ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : data.items.length === 0 ? (
        <div className="card admin-empty">
          <Icon name="list" size={28} />
          <b>{filtered ? 'Không có hành động phù hợp' : 'Chưa có hành động nào'}</b>
        </div>
      ) : (
        <>
          <p className="muted small">{total} hành động · mới nhất ở trên cùng · nhật ký chỉ đọc</p>
          <div className="admin-table__wrap">
            <table className="admin-table" aria-label="Nhật ký hành động">
              <thead>
                <tr>
                  <th scope="col">Thời gian</th>
                  <th scope="col">Hành động</th>
                  <th scope="col">Đối tượng</th>
                  <th scope="col">Quản trị viên</th>
                  <th scope="col">Lý do</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} data-testid="log-row">
                    <td>
                      <Link to={`/admin/actions/${encodeURIComponent(a.id)}`} aria-label={`Chi tiết: ${actionLabel(a.action)} lúc ${formatDateTime(a.createdAt)}`}>
                        <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                      </Link>
                    </td>
                    <td>{actionLabel(a.action)}</td>
                    <td><TargetLink type={a.targetType} id={a.targetId} /></td>
                    <td><span className="admin-table__sub">{a.adminId}</span></td>
                    <td className="admin-log__reason">{a.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <nav className="admin-pager" aria-label="Phân trang">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => apply(filters, page - 1)}>
                Trang trước
              </button>
              <span className="muted small">Trang {page}/{pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => apply(filters, page + 1)}>
                Trang sau
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ActionLogPage() {
  return (
    <AdminGate title="Nhật ký hành động">
      <ActionLog />
    </AdminGate>
  );
}
