// =========================================================
// TourModerationHistory (UC16, #116, #297) — on the Studio tour page: the tour's
// current status and the notifications about this tour (AI rejection, approval,
// rejection, change request, hiding, reports, narration ready) with their reasons.
// Collapsed by default and loaded when opened; opened directly when the user comes
// from a tour notification. The server filters by tourId; "Xem thêm" loads the next page.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import NotificationItem from './NotificationItem.jsx';
import { errorMessage, OFFLINE_MESSAGE } from './NotificationsPage.jsx';
import { listNotifications } from '../../lib/notifications.js';

const PAGE_SIZE = 20;

export default function TourModerationHistory({ tourId, statusLabel }) {
  const location = useLocation();
  const [open, setOpen] = useState(!!location.state?.openHistory);
  const [items, setItems] = useState(null); // null = not loaded
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [moreError, setMoreError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    setMoreError(null);
    setItems(null);
    try {
      const res = await listNotifications({ page: 1, limit: PAGE_SIZE, tourId });
      if (mine !== seq.current) return;
      setItems(res?.items ?? []);
      setTotal(res?.total ?? 0);
      setPage(1);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e, 'Chưa tải được lịch sử kiểm duyệt'));
    }
  }, [tourId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function loadMore() {
    const mine = seq.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await listNotifications({ page: page + 1, limit: PAGE_SIZE, tourId });
      if (mine !== seq.current) return;
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((n) => n.id));
        return [...(cur ?? []), ...(res?.items ?? []).filter((n) => !seen.has(n.id))];
      });
      setTotal(res?.total ?? total);
      setPage(page + 1);
    } catch (e) {
      if (mine === seq.current) setMoreError(errorMessage(e, 'Chưa tải thêm được lịch sử'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <details
      className="card tour-history"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="tour-history__summary">
        <Icon name="clock" size={18} />
        <span>Lịch sử kiểm duyệt</span>
        {statusLabel ? <span className="chip">{statusLabel}</span> : null}
      </summary>

      {!open ? null : error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : items === null ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="muted small">Chưa có thông báo nào về tour này.</p>
      ) : (
        <>
          <ul className="notifs__list" aria-label="Lịch sử kiểm duyệt của tour">
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </ul>
          {moreError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{moreError}</div>
              <button className="btn btn--sm" onClick={loadMore}>Thử lại</button>
            </div>
          ) : null}
          {items.length < total && !moreError ? (
            <button className="btn btn--ghost btn--block" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Icon name="loader" size={18} className="spin" /> : null} Xem thêm
            </button>
          ) : null}
        </>
      )}
    </details>
  );
}
