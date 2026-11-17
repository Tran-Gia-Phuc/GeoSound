// =========================================================
// UC05 — Modal dialog for reporting a tour rating (Tourist or Author dispute).
// =========================================================
import { useState } from 'react';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import {
  RATING_REPORT_REASONS,
  RATING_REPORT_DESC_MAX,
  submitRatingReport,
} from '../../lib/rating-reports.js';

export default function ReportRatingDialog({ open, tourId, rating, isAuthor = false, onClose, onSubmitted }) {
  const [reasonType, setReasonType] = useState('SPAM');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!tourId || !rating?.id) return;
    setBusy(true);
    setError('');
    try {
      await submitRatingReport(tourId, rating.id, { reasonType, description });
      setDescription('');
      setReasonType('SPAM');
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      setError(err?.offline ? 'Không thể kết nối, vui lòng thử lại' : err?.message || 'Chưa gửi được báo cáo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={isAuthor ? 'Khiếu nại đánh giá' : 'Báo cáo đánh giá vi phạm'}
    >
      <form className="rv-report-form" onSubmit={handleSubmit}>
        {rating ? (
          <p className="muted small" style={{ marginBottom: 12 }}>
            Nhận xét của <b>{rating.userName || 'Người dùng GeoSound'}</b> ({rating.stars} sao)
          </p>
        ) : null}

        <div className="field" style={{ marginBottom: 12 }}>
          <span className="field__label">Lý do vi phạm</span>
          <div style={{ display: 'grid', gap: 8 }}>
            {RATING_REPORT_REASONS.map((r) => (
              <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="rating-report-reason"
                  value={r.value}
                  checked={reasonType === r.value}
                  onChange={() => setReasonType(r.value)}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="field" style={{ marginBottom: 12 }}>
          <span className="field__label">
            {isAuthor ? 'Giải trình chi tiết (không bắt buộc)' : 'Mô tả bổ sung (không bắt buộc)'}
          </span>
          <textarea
            className="input"
            rows={3}
            maxLength={RATING_REPORT_DESC_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Nhập thông tin bổ sung giúp quản trị viên xem xét..."
          />
          <span className="field__hint">{description.length}/{RATING_REPORT_DESC_MAX}</span>
        </label>

        {error ? (
          <div className="alert alert--warn" role="alert" style={{ marginBottom: 12 }}>
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : null}
            Gửi báo cáo
          </button>
        </div>
      </form>
    </Modal>
  );
}
