// =========================================================
// PublishPanel (UC09 A3) — "Sẵn sàng xuất bản?" ở trình chỉnh sửa tour.
//   - Checklist lấy từ máy chủ (GET readiness): mục bắt buộc ✓/✗, khuyến nghị ✓/!
//   - Mục chưa đạt có liên kết tới đúng chỗ cần sửa
//   - Xuất bản thẳng (D1 — chưa qua kiểm duyệt) / Gỡ xuống về Nháp
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { getPublishReadiness, publishTour, unpublishTour } from '../../lib/studio.js';

// Mục chưa đạt → nơi sửa.
function fixLink(key, tourId) {
  if (key === 'places' || key === 'placeDescriptions') return { to: `/studio/tours/${tourId}/places`, label: 'Thêm / sửa điểm dừng' };
  return { to: `/studio/tours/${tourId}`, label: 'Sửa thông tin tour' };
}

/**
 * @param {{ tourId: string, status: string, refreshKey?: any,
 *           onStatusChange: (tour: object) => void }} props
 * refreshKey: đổi giá trị để tải lại checklist (vd sau khi lưu thông tin tour).
 */
export default function PublishPanel({ tourId, status, refreshKey, onStatusChange }) {
  const [readiness, setReadiness] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setReadiness(await getPublishReadiness(tourId));
    } catch (e) {
      setError(e.message || 'Không kiểm tra được điều kiện xuất bản');
    }
  }, [tourId]);
  useEffect(() => {
    load();
  }, [load, refreshKey, status]);

  async function run(fn, okMsg) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const tour = await fn(tourId);
      onStatusChange(tour);
      setNotice(okMsg);
    } catch (e) {
      setError(e.missing?.length ? `${e.message}: ${e.missing.map((m) => m.label).join('; ')}` : e.message || 'Thao tác thất bại');
      load();
    } finally {
      setBusy(false);
    }
  }

  const isPublic = status === 'public';

  return (
    <section className="publish" aria-labelledby="publish-h">
      <div className="publish__head">
        <h2 className="studio__h2" id="publish-h">
          {isPublic ? 'Tour đang công khai' : 'Sẵn sàng xuất bản?'}
        </h2>
        {readiness && !isPublic ? (
          <span className={`chip ${readiness.ready ? 'chip--ok' : ''}`}>
            {readiness.checks.filter((c) => c.required && c.ok).length}/{readiness.checks.filter((c) => c.required).length} mục bắt buộc
          </span>
        ) : null}
      </div>

      {isPublic ? (
        <p className="muted small">Khách đã tìm thấy và nghe được tour này. Sửa nội dung sẽ đưa tour về Nháp, cần xuất bản lại.</p>
      ) : readiness === null && !error ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang kiểm tra…</p>
      ) : readiness ? (
        <ul className="checklist">
          {readiness.checks.map((c) => {
            const fix = c.ok ? null : fixLink(c.key, tourId);
            return (
              <li key={c.key} className={`checklist__item ${c.ok ? 'is-ok' : c.required ? 'is-missing' : 'is-warn'}`}>
                <Icon name={c.ok ? 'check-circle' : c.required ? 'x' : 'info'} size={18} className="checklist__icon" />
                <span className="checklist__label">
                  {c.label}
                  {!c.required ? <span className="muted small"> (khuyến nghị)</span> : null}
                </span>
                {fix ? (
                  fix.to ? (
                    <Link className="linkbtn checklist__fix" to={fix.to}>{fix.label}</Link>
                  ) : (
                    <a className="linkbtn checklist__fix" href={fix.href}>{fix.label}</a>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {readiness && !readiness.canPublish && !isPublic ? (
        <div className="alert" role="status">
          <Icon name="info" size={18} className="alert__icon" />
          <div>Tour đang bị quản trị viên ẩn hoặc hạn chế nên chưa thể tự xuất bản.</div>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
        </div>
      ) : null}
      {notice ? (
        <div className="alert studio-notice" role="status">
          <Icon name="check-circle" size={18} className="alert__icon" />
          <div>{notice}</div>
        </div>
      ) : null}

      <div className="publish__actions">
        <Link className="btn" to={`/studio/tours/${tourId}/preview?mode=gps`}>
          <Icon name="play" size={16} /> Xem thử như khách
        </Link>
        {isPublic ? (
          <>
            <Link className="btn btn--ghost" to={`/tour/${tourId}`}>Xem bản công khai</Link>
            <button className="btn btn--ghost" disabled={busy} onClick={() => run(unpublishTour, 'Đã gỡ tour về Nháp.')}>
              {busy ? <Icon name="loader" size={16} className="spin" /> : null} Gỡ xuống
            </button>
          </>
        ) : (
          <button
            className="btn btn--primary"
            disabled={busy || !readiness?.ready || !readiness?.canPublish}
            onClick={() => run(publishTour, 'Đã xuất bản! Khách có thể tìm thấy tour ở Khám phá.')}
          >
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="navigation" size={16} />} Xuất bản
          </button>
        )}
      </div>
    </section>
  );
}
