// =========================================================
// TourModerationHistory (UC16, #116) — on the Studio tour page: the tour's
// current status and the notifications about this tour (AI rejection, approval,
// rejection, change request, hiding, reports, narration ready) with their reasons.
// Collapsed by default and loaded when opened; opened directly when the user comes
// from a tour notification. The API has no tour filter, so the latest
// HISTORY_LIMIT notifications are filtered here by tourId.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import NotificationItem from './NotificationItem.jsx';
import { errorMessage, OFFLINE_MESSAGE } from './NotificationsPage.jsx';
import { listNotifications } from '../../lib/notifications.js';

const HISTORY_LIMIT = 50;

export default function TourModerationHistory({ tourId, statusLabel }) {
  const location = useLocation();
  const [open, setOpen] = useState(!!location.state?.openHistory);
  const [items, setItems] = useState(null); // null = not loaded
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      const res = await listNotifications({ page: 1, limit: HISTORY_LIMIT });
      const all = res?.items ?? [];
      setItems(all.filter((n) => n.tourId === tourId));
      setPartial((res?.total ?? 0) > all.length);
    } catch (e) {
      setError(errorMessage(e, 'Chưa tải được lịch sử kiểm duyệt'));
    }
  }, [tourId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

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
        <ul className="notifs__list" aria-label="Lịch sử kiểm duyệt của tour">
          {items.map((n) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </ul>
      )}
      {open && items && partial ? (
        <p className="muted small">Chỉ xét {HISTORY_LIMIT} thông báo gần nhất của bạn.</p>
      ) : null}
    </details>
  );
}
