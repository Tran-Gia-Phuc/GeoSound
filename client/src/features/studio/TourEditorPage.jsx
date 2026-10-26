// =========================================================
// TourEditorPage — bước "Thông tin" của Studio (UC09 A1/A2):
//   - Sửa nội dung (tên/ngôn ngữ/loại/thành phố/thời lượng/mô tả/ảnh bìa).
//     Lưu chỉ gửi các trường THAY ĐỔI; sửa tour công khai sẽ về Nháp (A1).
//   - Xoá tour (A2) — xác nhận bằng ConfirmDialog.
// Các bước khác (điểm dừng, vùng kích hoạt, ngôn ngữ, xuất bản) nằm trên stepper
// của StudioTourLayout.
// =========================================================
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import TourForm from './TourForm.jsx';
import { useStudioTour } from './StudioTourLayout.jsx';
import { updateTour, deleteTour } from '../../lib/studio.js';

export default function TourEditorPage() {
  const navigate = useNavigate();
  const { tour, readiness, refresh, setTour } = useStudioTour();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function buildPatch(values) {
    const patch = {};
    for (const [k, v] of Object.entries(values)) {
      const cur = k === 'duration' ? tour[k] ?? null : tour[k] ?? '';
      if (v !== cur) patch[k] = v;
    }
    return patch;
  }

  async function onSave(values) {
    const patch = buildPatch(values);
    if (Object.keys(patch).length === 0) {
      setNotice('Không có thay đổi nào để lưu');
      setSaveError('');
      return;
    }
    setBusy(true);
    setSaveError('');
    setNotice('');
    try {
      const res = await updateTour(tour.id, patch);
      if (res.tour) setTour(res.tour);
      await refresh();
      setNotice(
        res.requiresResubmit ? 'Đã lưu. Tour công khai đã chuyển về Nháp — cần xuất bản lại.' : 'Đã lưu thay đổi.',
      );
    } catch (e) {
      setSaveError(e.message || 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deleteTour(tour.id);
      navigate('/studio', { replace: true });
    } catch (e) {
      setSaveError(e.message || 'Không xoá được tour');
      setDeleting(false);
    }
  }

  const noPlaces = readiness && !readiness.placeCount;

  return (
    <div className="studio-step studio__main--narrow">
      {noPlaces ? (
        <div className="alert studio-next" role="status">
          <Icon name="map-pin" size={18} className="alert__icon" />
          <div>Tour chưa có điểm dừng nào. Thêm điểm đầu tiên để khách nghe được tour.</div>
          <Link className="btn btn--primary btn--sm" to={`/studio/tours/${tour.id}/places`}>Thêm điểm</Link>
        </div>
      ) : null}

      {notice ? (
        <div className="alert studio-notice" role="status">
          <Icon name="check-circle" size={18} className="alert__icon" />
          <div>{notice}</div>
        </div>
      ) : null}

      <TourForm
        key={tour.updatedAt || tour.id}
        initial={tour}
        submitLabel="Lưu thay đổi"
        busy={busy}
        serverError={saveError}
        onSubmit={onSave}
      />

      <section className="studio-danger">
        <h2 className="studio__h2">Vùng nguy hiểm</h2>
        <div className="studio-danger__row">
          <div>
            <b>Xoá tour</b>
            <p className="muted small">Xoá vĩnh viễn tour này cùng các điểm dừng của nó.</p>
          </div>
          <button className="btn btn--danger" onClick={() => setConfirmDelete(true)} disabled={deleting}>
            {deleting ? <Icon name="loader" size={18} className="spin" /> : <Icon name="trash" size={18} />}
            Xoá tour
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={`Xoá tour “${tour.title}”?`}
        message="Tour và toàn bộ điểm dừng, bản dịch sẽ bị xoá vĩnh viễn. Không thể hoàn tác."
        confirmLabel="Xoá tour"
        danger
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
