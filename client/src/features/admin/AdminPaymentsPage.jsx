// =========================================================
// AdminPaymentsPage (/admin/payments) — UC25: every MoMo order, newest first.
//   - All-time paid total and revenue at the top; filter by status with ?status=; paging with ?page=N.
//   - Each row: tour, amount, status, buyer (link to /admin/users/:id), time, order id, MoMo ids.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { formatDateTime } from '../../lib/format.js';
import { ADMIN_PAYMENTS_LIMIT, PURCHASE_STATUS, formatVnd, listAllPurchases } from '../../lib/payment.js';
import { adminErrorMessage } from './admin-errors.js';

const FILTERS = [['', 'Tất cả'], ...Object.entries(PURCHASE_STATUS).map(([k, v]) => [k, v.label])];

function PaymentList() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const status = PURCHASE_STATUS[params.get('status')] ? params.get('status') : '';
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await listAllPurchases({ status, page }));
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được danh sách giao dịch'));
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const go = (next) => {
    const q = {};
    if (next.status) q.status = next.status;
    if (next.page > 1) q.page = String(next.page);
    setParams(q);
  };
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit || ADMIN_PAYMENTS_LIMIT)));

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Giao dịch" backTo="/admin" />
      <AdminNav />

      {data ? (
        <p className="small" data-testid="payments-summary">
          Đã thu <b>{formatVnd(data.revenue)}</b> từ {data.paidCount} đơn thanh toán thành công
        </p>
      ) : null}

      <div className="row" role="group" aria-label="Lọc theo trạng thái">
        {FILTERS.map(([k, label]) => (
          <button
            key={k || 'all'}
            type="button"
            className={`btn btn--sm ${status === k ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={status === k}
            onClick={() => go({ status: k, page: 1 })}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : data === null ? (
        <p className="muted"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
      ) : data.items.length === 0 ? (
        <div className="card admin-empty">
          <Icon name="check-circle" size={28} />
          <b>{status ? 'Không có giao dịch phù hợp' : 'Chưa có giao dịch nào'}</b>
        </div>
      ) : (
        <>
          <p className="muted small">{data.total} giao dịch · mới nhất ở trên cùng</p>
          <ul className="purchases" aria-label="Danh sách giao dịch">
            {data.items.map((p) => {
              const st = PURCHASE_STATUS[p.status] ?? PURCHASE_STATUS.pending;
              return (
                <li key={p.orderId} className="card purchase" data-testid="admin-payment-row">
                  <div className="purchase__head">
                    {p.tourTitle ? (
                      <Link className="purchase__title" to={`/tour/${encodeURIComponent(p.tourId)}`}>{p.tourTitle}</Link>
                    ) : (
                      <span className="purchase__title">Tour không còn khả dụng</span>
                    )}
                    <span className={st.chip}>{st.label}</span>
                  </div>
                  <div className="purchase__meta muted small">
                    <strong className="purchase__amount">{formatVnd(p.amount)}</strong>
                    <span>
                      <Icon name="clock" size={12} />{' '}
                      <time dateTime={p.paidAt || p.createdAt}>{formatDateTime(p.paidAt || p.createdAt)}</time>
                    </span>
                    <Link to={`/admin/users/${encodeURIComponent(p.userId)}`}>Người mua …{String(p.userId).slice(-6)}</Link>
                  </div>
                  <div className="purchase__meta muted small">
                    <span>Mã đơn {p.orderId}</span>
                    {p.transId ? <span>Mã MoMo {p.transId}</span> : null}
                    {p.resultCode != null && p.status !== 'paid' ? <span>Mã kết quả {p.resultCode}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {pages > 1 ? (
            <nav className="admin-pager" aria-label="Phân trang">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => go({ status, page: page - 1 })}>
                Trang trước
              </button>
              <span className="muted small">Trang {page}/{pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => go({ status, page: page + 1 })}>
                Trang sau
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function AdminPaymentsPage() {
  return (
    <AdminGate title="Giao dịch">
      <PaymentList />
    </AdminGate>
  );
}
