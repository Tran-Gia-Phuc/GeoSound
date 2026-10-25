// =========================================================
// CompletionDialog — thông báo kết thúc tour (UC04 bước 14) + gợi ý đánh giá (UC05).
// UC05 chưa triển khai: phần chọn sao là gợi ý, chưa gửi lên máy chủ.
// =========================================================
import { useState } from 'react';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';

export default function CompletionDialog({ open, onClose, onReplay, tourTitle, placeCount }) {
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Hoàn thành tour">
      <div className="complete">
        <div className="complete__badge">
          <Icon name="check-circle" size={40} />
        </div>
        <p className="complete__lead">
          Bạn đã nghe hết <strong>{placeCount}</strong> điểm của tour <strong>{tourTitle}</strong>. Cảm ơn bạn đã đồng hành!
        </p>

        <div className="complete__rate" role="group" aria-label="Đánh giá tour">
          <span className="complete__ratelabel">Bạn thấy tour thế nào?</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`star ${n <= rating ? 'star--on' : ''}`}
                onClick={() => {
                  setRating(n);
                  setSent(true);
                }}
                aria-label={`${n} sao`}
                aria-pressed={n <= rating}
              >
                <Icon name="star" size={28} />
              </button>
            ))}
          </div>
          {sent ? <p className="complete__note">Cảm ơn đánh giá của bạn! (Gửi đánh giá sẽ có ở UC05.)</p> : null}
        </div>

        <div className="complete__actions">
          <button className="btn btn--ghost" onClick={onReplay}>
            Nghe lại
          </button>
          <button className="btn btn--primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </Modal>
  );
}
