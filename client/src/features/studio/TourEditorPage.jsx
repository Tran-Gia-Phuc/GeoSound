// =========================================================
// TourEditorPage (UC09 A1/A2) — trung tâm chỉnh sửa một tour của tôi:
//   - Sửa nội dung (tên/ngôn ngữ/loại/thành phố/thời lượng/mô tả/ảnh bìa).
//     Lưu chỉ gửi các trường THAY ĐỔI; sửa tour công khai sẽ về Nháp (A1).
//   - Điều hướng sang các khu khác: điểm dừng (UC10), route (UC11),
//     ngôn ngữ & TTS (UC12), xem thử (UC13) — bật dần theo từng tính năng.
//   - Xoá tour (A2).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import StudioHeader, { StatusChip } from './StudioHeader.jsx';
import TourForm from './TourForm.jsx';
import { getMyTour, updateTour, deleteTour, statusMeta } from '../../lib/studio.js';

// Các khu quản lý tour. `enabled` bật dần khi từng UC client hoàn thành.
const AREAS = [
  { key: 'places', to: 'places', icon: 'map-pin', title: 'Điểm dừng', desc: 'Thêm & sắp xếp các điểm trên tour', enabled: true },
  { key: 'route', to: 'route', icon: 'route', title: 'Route & vùng kích hoạt', desc: 'Đã có mặc định — tuỳ chỉnh nếu cần', enabled: true },
  { key: 'languages', to: 'languages', icon: 'languages', title: 'Ngôn ngữ & giọng đọc', desc: 'Ngôn ngữ phụ, bản dịch, giọng đọc', enabled: true },
  { key: 'preview', to: 'preview', icon: 'play', title: 'Xem thử', desc: 'Trải nghiệm tour như một khách', enabled: true },
];

export default function TourEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tour, setTour] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setTour(await getMyTour(id));
    } catch (e) {
      setLoadError(e.message || 'Không tải được tour');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

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
      const res = await updateTour(id, patch);
      setTour(res.tour ?? (await getMyTour(id)));
      setNotice(
        res.requiresResubmit
          ? 'Đã lưu. Tour công khai đã chuyển về Nháp — cần gửi duyệt lại.'
          : 'Đã lưu thay đổi.',
      );
    } catch (e) {
      setSaveError(e.message || 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Xoá tour “${tour.title}”? Hành động này không thể hoàn tác.`)) return;
    setDeleting(true);
    try {
      await deleteTour(id);
      navigate('/studio', { replace: true });
    } catch (e) {
      setSaveError(e.message || 'Không xoá được tour');
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <div className="screen studio">
        <StudioHeader title="Chỉnh sửa tour" backTo="/studio" />
        <main className="studio__main studio__main--narrow">
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{loadError}</div>
          </div>
          <Link to="/studio" className="btn">Về danh sách tour</Link>
        </main>
      </div>
    );
  }
  if (!tour) {
    return (
      <div className="screen studio">
        <StudioHeader title="Chỉnh sửa tour" backTo="/studio" />
        <main className="studio__main studio__main--narrow">
          <p className="muted studio__loading"><Icon name="loader" size={20} className="spin" /> Đang tải…</p>
        </main>
      </div>
    );
  }

  const meta = statusMeta(tour.status);

  return (
    <div className="screen studio">
      <StudioHeader title={tour.title} backTo="/studio" />

      <main className="studio__main studio__main--narrow">
        <div className="studio-status">
          <StatusChip meta={meta} />
          {tour.status === 'public' ? (
            <Link className="linkbtn" to={`/tour/${tour.id}`}>Xem bản công khai →</Link>
          ) : null}
        </div>

        {/* Khu điều hướng tới các phần khác của tour */}
        <section className="studio-areas" aria-label="Quản lý nội dung tour">
          {AREAS.map((a) =>
            a.enabled ? (
              <Link key={a.key} to={`/studio/tours/${id}/${a.to}`} className="studio-area">
                <span className="studio-area__icon"><Icon name={a.icon} size={20} /></span>
                <span className="studio-area__text">
                  <b>{a.title}</b>
                  <span className="muted small">{a.desc}</span>
                </span>
                <Icon name="chevron-left" size={16} className="studio-area__chev" />
              </Link>
            ) : (
              <div key={a.key} className="studio-area studio-area--soon" aria-disabled="true">
                <span className="studio-area__icon"><Icon name={a.icon} size={20} /></span>
                <span className="studio-area__text">
                  <b>{a.title}</b>
                  <span className="muted small">{a.desc}</span>
                </span>
                <span className="chip">Sắp có</span>
              </div>
            ),
          )}
        </section>

        <h2 className="studio__h2">Thông tin tour</h2>
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
            <button className="btn btn--danger" onClick={onDelete} disabled={deleting}>
              {deleting ? <Icon name="loader" size={18} className="spin" /> : <Icon name="trash" size={18} />}
              Xoá tour
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
