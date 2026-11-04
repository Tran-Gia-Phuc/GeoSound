// =========================================================
// CompletionDialog — thông báo kết thúc tour (UC04 bước 14).
// UC05 (#105): invites to rate with a link to the tour detail ratings section (rateHref);
// a signed-in user who already rated sees "Xem đánh giá của bạn" instead.
// =========================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getMyRating } from '../../lib/ratings.js';

/** null = unknown (guest, author or request failed), true/false = has my rating. */
function useHasRated(open, tourId, authenticated) {
  const [rated, setRated] = useState(null);
  useEffect(() => {
    if (!open || !tourId || !authenticated) return undefined;
    const abort = new AbortController();
    getMyRating(tourId, { signal: abort.signal })
      .then((r) => setRated(!!r))
      .catch(() => setRated(null));
    return () => abort.abort();
  }, [open, tourId, authenticated]);
  return rated;
}

export default function CompletionDialog({ open, onClose, onReplay, onExplore, exploreLabel = 'Khám phá tour khác', tourTitle, placeCount, rateHref, tourId }) {
  const { authenticated } = useAuth();
  const rated = useHasRated(open && !!rateHref, tourId, authenticated);
  return (
    <Modal open={open} onClose={onClose} title="Hoàn thành tour">
      <div className="complete">
        <div className="complete__badge">
          <Icon name="check-circle" size={40} />
        </div>
        <p className="complete__lead">
          Bạn đã nghe hết <strong>{placeCount}</strong> điểm của tour <strong>{tourTitle}</strong>. Cảm ơn bạn đã đồng hành!
        </p>

        {rateHref ? (
          <div className="complete__rate">
            <span className="complete__ratelabel">
              {rated ? 'Bạn đã đánh giá tour này.' : 'Bạn thấy tour này thế nào?'}
            </span>
            <Link className="btn btn--ghost btn--sm" to={rateHref} onClick={onClose}>
              <Icon name="star" size={16} className="rating__star" /> {rated ? 'Xem đánh giá của bạn' : 'Đánh giá tour'}
            </Link>
          </div>
        ) : null}

        <div className="complete__actions">
          <button className="btn btn--ghost" onClick={onReplay}>
            Nghe lại
          </button>
          {onExplore ? (
            <button className="btn btn--primary" onClick={onExplore}>
              <Icon name="search" size={16} /> {exploreLabel}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={onClose}>
              Đóng
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
