// =========================================================
// NotificationItem (UC16) — one in-app notification: title, reason (body), the
// AI reasons of an automatic rejection, relative time and an unread mark.
// With `onOpen` the whole card is a button (notification centre); without it the
// card is read-only (moderation history on the Studio tour page).
// =========================================================
import Icon from '../../components/Icon.jsx';
import { formatDateTime, formatRelative } from '../../lib/format.js';

const TYPE_ICON = {
  'tour.approved': 'check-circle',
  'tts.render.completed': 'volume',
  'tour.reported': 'info',
};

/** AI reasons of `tour.ai_rejected` (`data.reasons[{ field, category, message }]`). */
function reasonsOf(n) {
  const list = Array.isArray(n?.data?.reasons) ? n.data.reasons : [];
  return list.map((r) => (typeof r?.message === 'string' ? r.message.trim() : '')).filter(Boolean);
}

export default function NotificationItem({ notification: n, onOpen, busy = false }) {
  const reasons = reasonsOf(n).filter((m) => m !== n.body?.trim());
  const unread = !n.read;
  const content = (
    <>
      <span className="notif__icon" aria-hidden="true">
        <Icon name={TYPE_ICON[n.type] || 'alert-triangle'} size={18} />
      </span>
      <span className="notif__main">
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
        <time className="notif__time muted small" dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
          {formatRelative(n.createdAt)}
        </time>
      </span>
      {unread ? <span className="notif__dot" aria-hidden="true" /> : null}
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
