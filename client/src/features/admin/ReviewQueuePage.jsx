// =========================================================
// ReviewQueuePage (/admin/reviews) — UC19 queue of tours waiting for an admin (Frontend #122).
//   - Order comes from the API: ai_warning first, then the oldest submission first.
//   - Only ai_warning / pending_review tours are returned (an AI Reject never reaches the queue).
//   - Each row: title, status chip (AI Warning / Chờ duyệt), city, AI / geo reason count, time sent.
//   - The API is not paged: the whole list is shown. Loading / empty (E1) / error with retry.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { adminErrorMessage, OFFLINE_MESSAGE } from './admin-errors.js';
import { listReviewQueue } from '../../lib/admin-reviews.js';
import { formatDateTime } from '../../lib/format.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';

/** Status chip of a queue item: "AI Warning" stands out, the rest is "Chờ duyệt". */
export function ReviewStatusChip({ status, aiWarning }) {
  return aiWarning || status === 'ai_warning' ? (
    <span className="statuschip statuschip--warn">AI Warning</span>
  ) : (
    <span className="statuschip statuschip--info">Chờ duyệt</span>
  );
}

function ReviewQueue() {
  const [tours, setTours] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setTours(null);
    try {
      const body = await listReviewQueue();
      setTours(Array.isArray(body?.tours) ? body.tours : []);
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được hàng chờ duyệt'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const warnings = (tours || []).filter((t) => t.aiWarning || t.status === 'ai_warning').length;

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Duyệt tour" backTo="/admin" />
      <AdminNav />

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {tours === null ? (
        error ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : tours.length === 0 ? (
        <div className="card admin-empty">
          <Icon name="check-circle" size={28} />
          <b>Không có tour nào chờ duyệt</b>
          <span className="muted small">Tour qua bước kiểm duyệt AI sẽ xuất hiện ở đây.</span>
        </div>
      ) : (
        <>
          <p className="muted small" data-testid="queue-summary">
            {tours.length} tour chờ duyệt{warnings ? ` · ${warnings} có cảnh báo AI` : ''} · cảnh báo AI và tour gửi sớm nhất ở trên cùng
          </p>
          <ul className="admin-list" aria-label="Tour chờ duyệt">
            {tours.map((t) => {
              const reasons = Array.isArray(t.moderationReasons) ? t.moderationReasons.length : 0;
              return (
                <li key={t.id}>
                  <Link className="card admin-report" to={`/admin/reviews/${encodeURIComponent(t.id)}`} data-testid="review-row">
                    <div className="admin-report__head">
                      <b className="admin-report__title">{t.title || 'Tour không tên'}</b>
                    </div>
                    <div className="admin-report__chips">
                      <ReviewStatusChip status={t.status} aiWarning={t.aiWarning} />
                      {reasons ? (
                        <span className="chip" data-testid="reason-count">{reasons} lý do AI</span>
                      ) : null}
                    </div>
                    {[t.city, TOUR_TYPE_LABELS[t.type]].filter(Boolean).length ? (
                      <span className="small admin-report__reasons">
                        {[t.city, TOUR_TYPE_LABELS[t.type]].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    {t.submittedAt ? (
                      <span className="muted small">
                        Gửi lúc <time dateTime={t.submittedAt}>{formatDateTime(t.submittedAt)}</time>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <AdminGate title="Duyệt tour">
      <ReviewQueue />
    </AdminGate>
  );
}
