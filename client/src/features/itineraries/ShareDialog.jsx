// =========================================================
// ShareDialog (UC07 / A4) — bật/tắt chia sẻ lịch trình và sao chép liên kết.
// Link = <origin>/shared/<shareToken>. Thu hồi sẽ vô hiệu link cũ.
// =========================================================
import { useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { shareItinerary } from '../../lib/itineraries.js';

function shareUrl(token) {
  return `${window.location.origin}/shared/${token}`;
}

export default function ShareDialog({ open, onClose, itinerary, onChanged }) {
  const [token, setToken] = useState(itinerary?.shareToken || null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(itinerary?.shareToken || null);
  }, [itinerary?.shareToken, open]);

  async function toggle(enabled) {
    setBusy(true);
    setError('');
    try {
      const r = await shareItinerary(itinerary.id, enabled);
      setToken(r.shareToken);
      onChanged?.();
    } catch (e) {
      setError(e.message || 'Thao tác chia sẻ thất bại');
    } finally {
      setBusy(false);
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Không sao chép được, hãy chọn và copy thủ công.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Chia sẻ lịch trình">
      <div className="share">
        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
          </div>
        ) : null}

        {token ? (
          <>
            <p className="muted small">Bất kỳ ai có liên kết này đều xem được lịch trình của bạn (chỉ đọc).</p>
            <div className="share__link">
              <input className="input" readOnly value={shareUrl(token)} onFocus={(e) => e.target.select()} aria-label="Liên kết chia sẻ" />
              <button className="btn btn--primary" onClick={copy}>
                <Icon name={copied ? 'check-circle' : 'copy'} size={18} /> {copied ? 'Đã copy' : 'Copy'}
              </button>
            </div>
            <button className="btn btn--ghost btn--block" onClick={() => toggle(false)} disabled={busy}>
              {busy ? <Icon name="loader" size={18} className="spin" /> : null} Thu hồi chia sẻ
            </button>
          </>
        ) : (
          <>
            <p className="muted small">Tạo liên kết để chia sẻ lịch trình này cho bạn bè.</p>
            <button className="btn btn--primary btn--block btn--lg" onClick={() => toggle(true)} disabled={busy}>
              {busy ? <Icon name="loader" size={18} className="spin" /> : <Icon name="share" size={18} />} Tạo liên kết chia sẻ
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
