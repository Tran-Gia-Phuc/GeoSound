// ConfirmDialog — hộp xác nhận dùng chung thay cho window.confirm (có tiêu đề,
// mô tả, nút nguy hiểm tô đỏ, đóng bằng Esc / chạm nền = huỷ).
import Modal from './Modal.jsx';

/**
 * @param {{ open: boolean, title: string, message?: React.ReactNode,
 *           confirmLabel?: string, cancelLabel?: string, danger?: boolean,
 *           onConfirm: () => void, onCancel: () => void }} props
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Đồng ý',
  cancelLabel = 'Huỷ',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} labelledBy="confirm-title">
      <div className="confirm">
        {message ? <p className="confirm__msg">{message}</p> : null}
        <div className="confirm__actions">
          <button className="btn btn--ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
