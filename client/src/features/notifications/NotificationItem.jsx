// =========================================================
// NotificationItem (UC16) — one in-app notification: title, reason (body), the
// AI reasons of an automatic rejection, relative time and an unread mark.
// With `onOpen` the whole card is a button (notification centre); without it the
// card is read-only (moderation history on the Studio tour page).
// =========================================================
import Icon from '../../components/Icon.jsx';
import { formatDateTime, formatRelative } from '../../lib/format.js';

const TYPE_META = {
  'tour.approved': { icon: 'check-circle', tone: 'success', badge: 'Đã duyệt' },
  'tour.ai_rejected': { icon: 'alert-triangle', tone: 'danger', badge: 'Cần sửa AI' },
  'tour.rejected': { icon: 'alert-triangle', tone: 'danger', badge: 'Bị từ chối' },
  'tour.changes_requested': { icon: 'edit', tone: 'warn', badge: 'Cần chỉnh sửa' },
  'tts.render.completed': { icon: 'volume', tone: 'primary', badge: 'Âm thanh AI' },
  'tour.reported': { icon: 'info', tone: 'warn', badge: 'Báo cáo' },
  'account.moderated': { icon: 'bell', tone: 'info', badge: 'Hệ thống' },
};

const FALLBACK_META = { icon: 'bell', tone: 'neutral', badge: 'Thông báo' };

/** AI reasons of `tour.ai_rejected` (`data.reasons[{ field, category, message }]`). */
function reasonsOf(n) {
  const list = Array.isArray(n?.data?.reasons) ? n.data.reasons : [];
  return list.map((r) => (typeof r?.message === 'string' ? r.message.trim() : '')).filter(Boolean);
}

export default function NotificationItem({ notification: n, onOpen, busy = false }) {
  const reasons = reasonsOf(n).filter((m) => m !== n.body?.trim());
  const unread = !n.read;
  const meta = TYPE_META[n.type] || FALLBACK_META;

  const content = (
    <>
      <span className={`notif__icon notif__icon--${meta.tone}`} aria-hidden="true">
        <Icon name={meta.icon} size={18} />
      </span>
      <span className="notif__main">
        <span className="notif__head">
          <span className={`notif__tag notif__tag--${meta.tone}`}>{meta.badge}</span>
          <time className="notif__time" dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
            <Icon name="clock" size={12} /> {formatRelative(n.createdAt)}
          </time>
        </span>
        <span className="notif__title">
          {n.title}
          {unread ? <span className="sr-only"> — chưa đọc</span> : null}
        </span>
        {n.body ? <span className="notif__body">{n.body}</span> : null}
        {reasons.length ? (
          <span className="notif__reasons">
            {reasons.map((m, i) => (
              <span key={i} className="notif__reason">• {m}</span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="notif__trail" aria-hidden="true">
        {unread ? <span className="notif__dot" /> : null}
        {onOpen ? (
          <span className="notif__chev">
            <Icon name="chevron-left" size={16} />
          </span>
        ) : null}
      </span>
    </>
  );

  const cls = `card notif ${unread ? 'notif--unread' : ''}`;
  return (
    <li className="notif__row" data-testid="notification">
      {onOpen ? (
        <button type="button" className={`${cls} notif--action`} onClick={() => onOpen(n)} disabled={busy}>
          {content}
        </button>
      ) : (
        <div className={cls}>{content}</div>
      )}
    </li>
  );
}
