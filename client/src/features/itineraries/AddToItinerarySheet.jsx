// =========================================================
// AddToItinerarySheet (UC07 bước 4–5) — "Thêm <địa điểm> vào…":
//   - chạm một lịch trình có sẵn → thêm ngay
//   - "＋ Lịch trình mới": nhập tên tại chỗ → tạo & thêm (đúng đặc tả: hỏi tên
//     lịch trình LÚC thêm, không bắt tạo trước ở màn khác)
//   - chưa đăng nhập → mời đăng nhập; quay lại màn cũ thì sheet tự mở lại cho
//     địa điểm đó (usePendingAdd) — không phải tìm lại từ đầu (D4)
// Xong → toast "Đã thêm vào X · Xem".
// =========================================================
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { listMyItineraries, createItinerary, addItem } from '../../lib/itineraries.js';
import { nextWithPendingAdd } from '../../hooks/usePendingAdd.js';

/**
 * @param {{ open: boolean, place: { placeId: string, name: string } | null, onClose: () => void }} props
 */
export default function AddToItinerarySheet({ open, place, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { authenticated } = useAuth();

  const [list, setList] = useState(null); // null = đang tải
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState(null); // id lịch trình đang thêm | 'new'
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !authenticated) return;
    setList(null);
    setError('');
    setName('');
    listMyItineraries()
      .then((l) => setList(Array.isArray(l) ? l : []))
      .catch((e) => {
        setError(e.message || 'Không tải được lịch trình');
        setList([]);
      });
  }, [open, authenticated]);

  const done = (itinerary) => {
    onClose();
    toast.show(`Đã thêm “${place.name}” vào ${itinerary.name}`, {
      action: { label: 'Xem', onClick: () => navigate(`/itineraries/${itinerary.id}`) },
    });
  };

  async function addTo(itinerary) {
    setBusyId(itinerary.id);
    setError('');
    try {
      await addItem(itinerary.id, place.placeId);
      done(itinerary);
    } catch (e) {
      setError(e.message || 'Không thêm được địa điểm');
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd(e) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setBusyId('new');
    setError('');
    try {
      const it = await createItinerary(v);
      await addItem(it.id, place.placeId);
      done(it);
    } catch (err) {
      setError(err.message || 'Không tạo được lịch trình');
    } finally {
      setBusyId(null);
    }
  }

  if (!place) return null;
  const next = nextWithPendingAdd(location.pathname, location.search, place);

  return (
    <Modal open={open} onClose={onClose} title={`Thêm “${place.name}” vào…`} labelledBy="add-itin-title">
      {!authenticated ? (
        <div className="addsheet__guest">
          <p className="muted">Đăng nhập để lưu địa điểm vào lịch trình và mở lại trên mọi thiết bị.</p>
          <button className="btn btn--primary btn--block" onClick={() => navigate(`/login?next=${encodeURIComponent(next)}`)}>
            Đăng nhập để lưu
          </button>
        </div>
      ) : (
        <div className="addsheet">
          {error ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{error}</div>
            </div>
          ) : null}

          {list === null ? (
            <p className="muted"><Icon name="loader" size={16} className="spin" /> Đang tải lịch trình…</p>
          ) : list.length ? (
            <ul className="addsheet__list">
              {list.map((it) => (
                <li key={it.id}>
                  <button className="addsheet__item" onClick={() => addTo(it)} disabled={!!busyId}>
                    <span className="addsheet__icon"><Icon name="route" size={18} /></span>
                    <span className="addsheet__text">
                      <b>{it.name}</b>
                      <span className="muted small">{it.placeCount} điểm</span>
                    </span>
                    {busyId === it.id ? <Icon name="loader" size={18} className="spin" /> : <Icon name="plus" size={18} />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Bạn chưa có lịch trình nào — đặt tên để tạo lịch trình đầu tiên.</p>
          )}

          <form className="addsheet__new" onSubmit={createAndAdd}>
            <label className="field__label" htmlFor="new-itin">Lịch trình mới</label>
            <div className="addsheet__newrow">
              <input
                id="new-itin"
                className="input"
                placeholder="Ví dụ: Hội An 1 ngày"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
              <button className="btn btn--primary" type="submit" disabled={!name.trim() || !!busyId}>
                {busyId === 'new' ? <Icon name="loader" size={16} className="spin" /> : <Icon name="plus" size={16} />}
                Tạo &amp; thêm
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
