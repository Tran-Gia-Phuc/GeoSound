// =========================================================
// NotificationsPage (/notifications) — UC16 notification centre (signed in).
//   - Newest first, 20 per page, "Xem thêm" for the next page.
//   - Filter "Tất cả" / "Chưa đọc"; "Đánh dấu tất cả đã đọc" while some are unread.
//   - Open one: mark it read, then go to its target (tour -> Studio tour page with
//     the moderation history open, account -> /account).
//   - E1: no notification -> "Chưa có thông báo nào".
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import NotificationItem from './NotificationItem.jsx';
import { useUnreadCount } from './UnreadCount.jsx';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTarget,
} from '../../lib/notifications.js';

export const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const PAGE_SIZE = 20;

export function errorMessage(err, fallback) {
  return err?.offline ? OFFLINE_MESSAGE : err?.message || fallback;
}

const FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'unread', label: 'Chưa đọc' },
];

export default function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { unread, setUnread } = useUnreadCount();
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState(null); // null = loading
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [moreError, setMoreError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    setMoreError(null);
    setItems(null);
    try {
      const res = await listNotifications({ page: 1, limit: PAGE_SIZE, unread: filter === 'unread' });
      if (mine !== seq.current) return;
      setItems(res?.items ?? []);
      setTotal(res?.total ?? 0);
      setPage(1);
      if (typeof res?.unread === 'number') setUnread(res.unread);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e, 'Chưa tải được thông báo'));
    }
  }, [filter, setUnread]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    const mine = seq.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await listNotifications({ page: page + 1, limit: PAGE_SIZE, unread: filter === 'unread' });
      if (mine !== seq.current) return;
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((n) => n.id));
        return [...(cur ?? []), ...(res?.items ?? []).filter((n) => !seen.has(n.id))];
      });
      setTotal(res?.total ?? total);
      setPage(page + 1);
      if (typeof res?.unread === 'number') setUnread(res.unread);
    } catch (e) {
      if (mine === seq.current) setMoreError(errorMessage(e, 'Chưa tải thêm được thông báo'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function onOpen(n) {
    if (!n.read) {
      setBusy(true);
      try {
        await markNotificationRead(n.id);
        setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
        setUnread(unread - 1);
      } catch (e) {
        // 404: already gone; any other failure only leaves it unread. Still open the target.
        if (e?.status !== 404) toast.show(errorMessage(e, 'Chưa đánh dấu được thông báo'), { tone: 'danger' });
      } finally {
        setBusy(false);
      }
    }
    navigate(notificationTarget(n), n.tourId ? { state: { openHistory: true } } : undefined);
  }

  async function onReadAll() {
    setBusy(true);
    try {
      const updated = await markAllNotificationsRead();
      setUnread(0);
      toast.show(updated ? `Đã đánh dấu ${updated} thông báo là đã đọc` : 'Không còn thông báo chưa đọc');
      if (filter === 'unread') {
        setItems([]);
        setTotal(0);
      } else {
        setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
      }
    } catch (e) {
      toast.show(errorMessage(e, 'Chưa đánh dấu được thông báo'), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const hasUnread = unread > 0 || (items ?? []).some((n) => !n.read);

  return (
    <div className="page page--narrow notifs">
      <AppHeader title="Thông báo" backTo="/account" />

      <div className="notifs__bar">
        <div className="segmented notifs__filter" role="radiogroup" aria-label="Lọc thông báo">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              className={`segmented__item ${filter === f.value ? 'is-active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value === 'unread' && unread > 0 ? <span className="notifs__count">{unread}</span> : null}
            </button>
          ))}
        </div>
        {items && hasUnread ? (
          <button className="btn btn--ghost btn--sm" onClick={onReadAll} disabled={busy}>
            <Icon name="check-circle" size={16} /> Đánh dấu tất cả đã đọc
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {items === null ? (
        error ? null : (
          <p className="muted notifs__loading">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : items.length === 0 ? (
        <div className="card notifs__empty">
          <Icon name="bell" size={32} />
          <b>{filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}</b>
          <p className="muted small">
            Khi tour của bạn được duyệt, bị từ chối, cần chỉnh sửa hoặc thuyết minh đã sẵn sàng, thông báo sẽ hiện ở đây.
          </p>
        </div>
      ) : (
        <>
          <ul className="notifs__list" aria-label="Danh sách thông báo">
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} onOpen={onOpen} busy={busy} />
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
    </div>
  );
}
