// =========================================================
// UsersPage (/admin/users) — UC21 account search for admins.
//   - Search by email or name (q), filter by role and effective status; state lives in the URL
//     (?q=&role=&status=&page=) so the back button keeps the search.
//   - Newest account first (API order), paging, loading / empty / error with retry.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { adminErrorMessage } from './admin-errors.js';
import {
  ACCOUNT_STATUS_META,
  ROLE_LABELS,
  USERS_LIMIT,
  accountStatusMeta,
  roleLabel,
  searchUsers,
} from '../../lib/admin-users.js';
import { formatDateTime } from '../../lib/format.js';

export function AccountStatusChip({ status }) {
  const meta = accountStatusMeta(status);
  return <span className={`statuschip statuschip--${meta.tone}`}>{meta.label}</span>;
}

function UserSearch() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);

  const [draft, setDraft] = useState(q);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => setDraft(q), [q]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await searchUsers({ q, role, status, page, limit: USERS_LIMIT }));
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được danh sách tài khoản'));
    }
  }, [q, role, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  /** Updates the URL filters; any change of filter goes back to page 1. */
  function apply(next) {
    const merged = { q, role, status, page: 1, ...next };
    const sp = {};
    if (merged.q.trim()) sp.q = merged.q.trim();
    if (merged.role) sp.role = merged.role;
    if (merged.status) sp.status = merged.status;
    if (merged.page > 1) sp.page = String(merged.page);
    setParams(sp);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.limit || USERS_LIMIT)));
  const filtered = Boolean(q || role || status);

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Tài khoản" backTo="/admin" />
      <AdminNav />

      <form
        className="card admin-filters"
        role="search"
        aria-label="Tìm tài khoản"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: draft });
        }}
      >
        <div className="admin-filters__search">
          <label className="sr-only" htmlFor="admin-user-q">Email hoặc họ tên</label>
          <input
            id="admin-user-q"
            className="input"
            type="search"
            placeholder="Email hoặc họ tên"
            maxLength={200}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn--primary" type="submit">
            <Icon name="search" size={18} /> Tìm
          </button>
        </div>
        <div className="admin-filters__row">
          <label className="field">
            <span className="field__label">Vai trò</span>
            <select className="input" value={role} onChange={(e) => apply({ role: e.target.value, q: draft })}>
              <option value="">Tất cả vai trò</option>
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Trạng thái</span>
            <select className="input" value={status} onChange={(e) => apply({ status: e.target.value, q: draft })}>
              <option value="">Tất cả trạng thái</option>
              {Object.entries(ACCOUNT_STATUS_META).map(([v, m]) => (
                <option key={v} value={v}>{m.label}</option>
              ))}
            </select>
          </label>
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
          <Icon name="search" size={28} />
          <b>{filtered ? 'Không có tài khoản phù hợp' : 'Chưa có tài khoản nào'}</b>
          {filtered ? <span className="muted small">Thử từ khoá hoặc bộ lọc khác.</span> : null}
        </div>
      ) : (
        <>
          <p className="muted small">{total} tài khoản · mới nhất ở trên cùng</p>
          <ul className="admin-list" aria-label="Danh sách tài khoản">
            {data.items.map((u) => (
              <li key={u.id}>
                <Link className="card admin-report" to={`/admin/users/${encodeURIComponent(u.id)}`} data-testid="user-row">
                  <div className="admin-report__head">
                    <b className="admin-report__title">{u.fullName || 'Chưa đặt tên'}</b>
                    <AccountStatusChip status={u.status} />
                  </div>
                  <span className="muted small admin-table__sub">{u.email}</span>
                  <span className="muted small">
                    {roleLabel(u.role)}
                    {u.createdAt ? ` · tạo lúc ${formatDateTime(u.createdAt)}` : ''}
                  </span>
                  {u.status === 'suspended' && u.suspendedUntil ? (
                    <span className="small admin-report__reasons">Tạm khoá đến {formatDateTime(u.suspendedUntil)}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="admin-pager" aria-label="Phân trang">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => apply({ page: page - 1 })}>
                Trang trước
              </button>
              <span className="muted small">Trang {page}/{pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => apply({ page: page + 1 })}>
                Trang sau
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <AdminGate title="Tài khoản">
      <UserSearch />
    </AdminGate>
  );
}
