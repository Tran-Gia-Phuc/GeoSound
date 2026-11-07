// =========================================================
// SubmissionStatus (UC15) — result of "Gửi duyệt" on the Studio publish step:
//   #114 ai_checking     : AI is working; poll GET /mine/:id every 5 s while the page is visible,
//                          elapsed time, "Thử lại" when a poll fails. Never claims a result early.
//   #110 pending_review  : AI passed, waiting for the Admin.
//   #111 ai_warning      : waiting for the Admin, with the AI / geo reasons.
//   #112 draft + reasons : AI rejected, back to draft; changes_requested / rejected (Admin, UC19)
//                          with the admin reason. The author edits and submits again.
// =========================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import ModerationReasons from './ModerationReasons.jsx';
import { useVisiblePoll } from '../../hooks/useVisiblePoll.js';
import { getMyTour } from '../../lib/studio.js';
import { POLL_INTERVAL_MS, errorText, formatElapsed, submissionResult } from '../../lib/submission.js';

const RESULT_TOAST = {
  pending_review: 'Đã gửi duyệt thành công. Tour đang chờ Admin duyệt.',
  ai_warning: 'Đã gửi duyệt. AI có cảnh báo, tour đang chờ Admin duyệt.',
  draft: 'AI đã từ chối tour. Xem lý do, sửa rồi gửi duyệt lại.',
};
const ICON = { info: 'clock', warn: 'alert-triangle', danger: 'x' };

// Elapsed since the submit (the tour's updatedAt); a missing or future timestamp (clock skew)
// falls back to the time this screen started watching.
function elapsedOf(updatedAt, watchingSince, now) {
  const t = Date.parse(updatedAt ?? '');
  return Number.isFinite(t) && t <= now ? now - t : now - watchingSince;
}

/**
 * @param {{ tour: object, places?: Array<{ id, name }>, onTourChange: (tour: object) => void }} props
 */
export default function SubmissionStatus({ tour, places = [], onTourChange }) {
  const toast = useToast();
  const result = submissionResult(tour);
  const checking = tour?.status === 'ai_checking';

  // #114 — elapsed time since the submit (the tour's updatedAt), ticking every second.
  const [watchingSince, setWatchingSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!checking) return undefined;
    setWatchingSince(Date.now());
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [checking]);
  const elapsed = elapsedOf(tour?.updatedAt, watchingSince, now);

  const { error: pollError, retry } = useVisiblePoll(
    async () => {
      const fresh = await getMyTour(tour.id);
      if (fresh && fresh.status !== tour.status) onTourChange(fresh);
    },
    { enabled: checking, intervalMs: POLL_INTERVAL_MS },
  );

  // Toast only when the server reports the result while the author watches.
  const prev = useRef(tour?.status);
  useEffect(() => {
    const before = prev.current;
    prev.current = tour?.status;
    if (before === 'ai_checking' && tour?.status !== 'ai_checking' && RESULT_TOAST[tour?.status]) {
      toast.show(RESULT_TOAST[tour.status], tour.status === 'draft' ? { tone: 'danger' } : undefined);
    }
  }, [tour?.status, toast]);

  if (!result) return null;
  const reasons = Array.isArray(tour.moderationReasons) ? tour.moderationReasons : [];
  const adminReason = (result.kind === 'changes' || result.kind === 'admin-rejected') && tour.reviewReason;
  const canFix = result.kind === 'ai-rejected' || result.kind === 'changes' || result.kind === 'admin-rejected';

  return (
    <section
      className={`submission submission--${result.tone}`}
      aria-labelledby="submission-h"
      data-state={result.kind}
    >
      <div className="submission__head">
        <Icon
          name={checking ? 'loader' : ICON[result.tone] || 'info'}
          size={20}
          className={`submission__icon ${checking ? 'spin' : ''}`}
        />
        <h2 className="studio__h2" id="submission-h">{result.title}</h2>
      </div>
      <p className="submission__text">{result.text}</p>

      {checking ? (
        <p className="submission__elapsed muted small" role="timer" aria-live="off">
          <Icon name="clock" size={14} /> Đã chờ <span data-testid="elapsed">{formatElapsed(elapsed)}</span>
          {elapsed >= 2 * 60 * 1000 ? (
            <> · AI đang bận, hệ thống sẽ tự thử lại. Bạn có thể rời trang, kết quả sẽ có trong Thông báo.</>
          ) : null}
        </p>
      ) : null}
      {checking && pollError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={pollError.offline ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>Chưa cập nhật được trạng thái: {errorText(pollError, 'lỗi không xác định')}</div>
          <button className="btn btn--sm" onClick={retry}>Thử lại</button>
        </div>
      ) : null}

      {adminReason ? (
        <blockquote className="submission__admin">
          <span className="muted small">Lý do của Admin</span>
          <p>{tour.reviewReason}</p>
        </blockquote>
      ) : null}

      {result.kind === 'checking' || result.kind === 'pending' ? null : (
        <ModerationReasons reasons={reasons} places={places} tourId={tour.id} label="Lý do kiểm duyệt AI" />
      )}

      {canFix ? (
        <div className="submission__actions">
          <Link className="btn btn--sm" to={`/studio/tours/${tour.id}`}>
            <Icon name="edit" size={14} /> Sửa thông tin tour
          </Link>
          <Link className="btn btn--sm" to={`/studio/tours/${tour.id}/places`}>
            <Icon name="map-pin" size={14} /> Sửa điểm dừng
          </Link>
        </div>
      ) : null}
    </section>
  );
}
