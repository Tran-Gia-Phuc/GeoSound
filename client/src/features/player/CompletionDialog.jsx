// =========================================================
// CompletionDialog — thông báo kết thúc tour (UC04 bước 14).
// Phần đánh giá sẽ thêm khi làm UC05; tới lúc đó KHÔNG hiện chọn sao giả.
// =========================================================
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';

export default function CompletionDialog({ open, onClose, onReplay, onExplore, exploreLabel = 'Khám phá tour khác', tourTitle, placeCount }) {
  return (
    <Modal open={open} onClose={onClose} title="Hoàn thành tour">
      <div className="complete">
        <div className="complete__badge">
          <Icon name="check-circle" size={40} />
        </div>
        <p className="complete__lead">
          Bạn đã nghe hết <strong>{placeCount}</strong> điểm của tour <strong>{tourTitle}</strong>. Cảm ơn bạn đã đồng hành!
        </p>

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
