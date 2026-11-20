// =========================================================
// PurchaseHistoryPage (UC25, #446) — /account/purchases: the signed-in account's MoMo orders
// (every attempt, newest first, at most 50), from GET /api/tours/purchases/mine.
// A pending order links to the return page, which asks MoMo again; a paid one links to its tour.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { formatDateTime } from '../../lib/format.js';
import { PURCHASE_STATUS, formatVnd, listMyPurchases } from '../../lib/payment.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';

export default function PurchaseHistoryPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setItems(null);
    try {
      setItems((await listMyPurchases())?.items ?? []);
    } catch (e) {
      setError(e?.offline ? OFFLINE_MESSAGE : e?.message || 'Chưa tải được lịch sử giao dịch');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let body;
  if (error) {
    body = (
      <div className="alert alert--warn" role="alert">
        <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
        <div>{error}</div>
        <button className="btn btn--sm" onClick={load}>Thử lại</button>
      </div>
    );
  } else if (items === null) {
    body = <p className="muted"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>;
  } else if (!items.length) {
    body = (
      <div className="card purchases__empty">
        <p>Bạn chưa mua tour nào.</p>
        <Link className="btn btn--primary btn--sm" to="/">Khám phá tour</Link>
      </div>
    );
  } else {
    body = (
      <ul className="purchases" aria-label="Lịch sử giao dịch">
        {items.map((p) => {
          const st = PURCHASE_STATUS[p.status] ?? PURCHASE_STATUS.pending;
          const title = p.tourTitle || 'Tour không còn khả dụng';
          return (
            <li key={p.orderId} className="card purchase" data-testid="purchase-row">
              <div className="purchase__head">
                {p.tourTitle ? (
                  <Link className="purchase__title" to={`/tour/${encodeURIComponent(p.tourId)}`}>{title}</Link>
                ) : (
                  <span className="purchase__title">{title}</span>
                )}
                <span className={st.chip}>{st.label}</span>
              </div>
              <div className="purchase__meta muted small">
                <strong className="purchase__amount">{formatVnd(p.amount)}</strong>
                <span>
                  <Icon name="clock" size={12} />{' '}
                  <time dateTime={p.paidAt || p.createdAt}>{formatDateTime(p.paidAt || p.createdAt)}</time>
                </span>
                <span>Mã đơn {p.orderId.slice(0, 8)}</span>
                {p.transId ? <span>Mã MoMo {p.transId}</span> : null}
              </div>
              {p.status === 'pending' ? (
                <Link className="btn btn--ghost btn--sm" to={`/payment/momo?orderId=${encodeURIComponent(p.orderId)}`}>
                  Kiểm tra lại
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="page">
      <AppHeader title="Lịch sử giao dịch" backTo="/account" />
      <p className="muted small">Các lần mua tour để tải về nghe offline, thanh toán qua MoMo.</p>
      {body}
    </div>
  );
}
