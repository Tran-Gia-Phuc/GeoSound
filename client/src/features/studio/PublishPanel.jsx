// =========================================================
// PublishPanel (UC09 A3, UC15) — "Sẵn sàng xuất bản?" / "Sẵn sàng gửi duyệt?" ở Studio.
//   - Checklist lấy từ máy chủ (GET readiness): mục bắt buộc ✓/✗, khuyến nghị ✓/!
//   - Mục chưa đạt có liên kết tới đúng chỗ cần sửa
//   - Máy chủ xuất bản thẳng (D1): nút "Xuất bản" / "Gỡ xuống" như cũ.
//   - Máy chủ bật kiểm duyệt (UC15, readiness có mục 'placesModeration'): nút "Gửi duyệt"
//     có hộp xác nhận; chặn khi còn điểm 'checking' / 'rejected' (D5) kèm liên kết sửa từng
//     điểm; sau khi gửi, SubmissionStatus theo dõi kết quả AI / Admin.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import SubmissionStatus from './SubmissionStatus.jsx';
import PlaceModerationChip from './PlaceModerationChip.jsx';
import ForbiddenZoneDetails from './ForbiddenZoneDetails.jsx';
import { useVisiblePoll } from '../../hooks/useVisiblePoll.js';
import { getPublishReadiness, listPlaces, publishTour, unpublishTour } from '../../lib/studio.js';
import {
  IN_REVIEW_STATUSES,
  POLL_INTERVAL_MS,
  blockingPlaces,
  errorText,
  isModerationMode,
} from '../../lib/submission.js';

const PLACE_KEYS = new Set(['places', 'placeDescriptions', 'placesModeration', 'placesLimit']);

// Mục chưa đạt → nơi sửa.
function fixLink(key, tourId) {
  if (PLACE_KEYS.has(key)) return { to: `/studio/tours/${tourId}/places`, label: 'Thêm / sửa điểm dừng' };
  return { to: `/studio/tours/${tourId}`, label: 'Sửa thông tin tour' };
}

const editPlaceLink = (tourId, placeId) => `/studio/tours/${tourId}/places?edit=${encodeURIComponent(placeId)}`;

/**
 * @param {{ tour: object, refreshKey?: any, onStatusChange: (tour: object) => void }} props
 * refreshKey: đổi giá trị để tải lại checklist (vd sau khi lưu thông tin tour).
 */
export default function PublishPanel({ tour, refreshKey, onStatusChange }) {
  const tourId = tour.id;
  const status = tour.status;
  const toast = useToast();
  const [readiness, setReadiness] = useState(null);
  const [places, setPlaces] = useState(null); // only loaded in moderation mode
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoneError, setZoneError] = useState(null);
  const [notice, setNotice] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getPublishReadiness(tourId);
      setReadiness(r);
      if (isModerationMode(r)) {
        // Keep the last list if this read fails: the checklist above still blocks a bad submit.
        const list = await listPlaces(tourId).catch(() => undefined);
        if (list !== undefined) setPlaces(list);
      }
    } catch (e) {
      setError(errorText(e, 'Không kiểm tra được điều kiện xuất bản'));
      throw e;
    }
  }, [tourId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, refreshKey, status]);

  const moderation = isModerationMode(readiness);
  const isPublic = status === 'public';
  const inReview = IN_REVIEW_STATUSES.has(status);
  const blocking = moderation ? blockingPlaces(places) : [];
  const warned = moderation ? (places || []).filter((p) => p.moderationStatus === 'warning') : [];
  const anyChecking = blocking.some((p) => p.moderationStatus === 'checking');

  // #137 — places still being scanned: refresh the checklist until the AI answers.
  const { error: placesPollError, retry: retryPlaces } = useVisiblePoll(load, {
    enabled: moderation && anyChecking && !inReview && !isPublic,
    intervalMs: POLL_INTERVAL_MS,
  });

  async function run(fn, kind) {
    setBusy(true);
    setError('');
    setZoneError(null);
    setNotice('');
    try {
      const next = await fn(tourId);
      onStatusChange(next);
      if (kind === 'unpublish') setNotice('Đã gỡ tour về Nháp.');
      else if (next?.status === 'public') setNotice('Đã xuất bản! Khách có thể tìm thấy tour ở Khám phá.');
      else if (next?.status === 'ai_checking') toast.show('Đã gửi tour cho AI kiểm duyệt. Kết quả sẽ hiện ở đây.');
    } catch (e) {
      if (e.code === 'forbidden_zone') setZoneError(e.zone ?? {});
      setError(
        e.missing?.length
          ? `${e.message}: ${e.missing.map((m) => m.label).join('; ')}`
          : errorText(e, 'Thao tác thất bại'),
      );
      load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const ready = !!readiness?.ready && !!readiness?.canPublish;
  const reviewing = moderation && inReview;
  const showChecklist = !isPublic && !reviewing;
  let heading = 'Sẵn sàng xuất bản?';
  if (isPublic) heading = 'Tour đang công khai';
  else if (reviewing) heading = 'Tour đang được duyệt';
  else if (moderation) heading = 'Sẵn sàng gửi duyệt?';

  let action = null;
  if (isPublic) {
    action = (
      <>
        <Link className="btn btn--ghost" to={`/tour/${tourId}`}>Xem bản công khai</Link>
        <button className="btn btn--ghost" disabled={busy} onClick={() => run(unpublishTour, 'unpublish')}>
          {busy ? <Icon name="loader" size={16} className="spin" /> : null} Gỡ xuống
        </button>
      </>
    );
  } else if (moderation && !inReview) {
    action = (
      <button
        className="btn btn--primary"
        disabled={busy || !ready || blocking.length > 0}
        onClick={() => setConfirmSubmit(true)}
      >
        {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="navigation" size={16} />}{' '}
        {status === 'draft' && !tour.moderationReasons?.length ? 'Gửi duyệt' : 'Gửi duyệt lại'}
      </button>
    );
  } else if (!moderation) {
    action = (
      <button className="btn btn--primary" disabled={busy || !ready} onClick={() => run(publishTour, 'publish')}>
        {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="navigation" size={16} />} Xuất bản
      </button>
    );
  }

  return (
    <>
      <SubmissionStatus tour={tour} places={places ?? []} onTourChange={onStatusChange} />

      <section className="publish" aria-labelledby="publish-h">
        <div className="publish__head">
          <h2 className="studio__h2" id="publish-h">{heading}</h2>
          {readiness && showChecklist ? (
            <span className={`chip ${readiness.ready ? 'chip--ok' : ''}`}>
              {readiness.checks.filter((c) => c.required && c.ok).length}/{readiness.checks.filter((c) => c.required).length} mục bắt buộc
            </span>
          ) : null}
        </div>

        {isPublic ? (
          <p className="muted small">Khách đã tìm thấy và nghe được tour này. Sửa nội dung sẽ đưa tour về Nháp, cần xuất bản lại.</p>
        ) : reviewing ? (
          <p className="muted small">
            Trong lúc duyệt, sửa tour hoặc điểm dừng sẽ rút tour khỏi hàng chờ và đưa về Nháp — bạn cần gửi duyệt lại.
          </p>
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
                  {fix ? <Link className="linkbtn checklist__fix" to={fix.to}>{fix.label}</Link> : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {showChecklist && blocking.length ? (
          <div className="publish__blocking" role="group" aria-label="Điểm dừng cần xử lý trước khi gửi duyệt">
            <p className="small"><b>Cần xử lý trước khi gửi duyệt:</b></p>
            <ul className="publish__places">
              {blocking.map((p) => (
                <li key={p.id}>
                  <span className="publish__placename">{p.name}</span>
                  <PlaceModerationChip status={p.moderationStatus} />
                  {p.moderationStatus === 'rejected' ? (
                    <Link className="linkbtn" to={editPlaceLink(tourId, p.id)}>Sửa “{p.name}”</Link>
                  ) : (
                    <span className="muted small">Chờ AI quét xong</span>
                  )}
                </li>
              ))}
            </ul>
            {placesPollError ? (
              <div className="alert alert--warn" role="alert">
                <Icon name="alert-triangle" size={18} className="alert__icon" />
                <div>Chưa cập nhật được kết quả quét: {errorText(placesPollError, 'lỗi không xác định')}</div>
                <button className="btn btn--sm" onClick={retryPlaces}>Thử lại</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {showChecklist && warned.length ? (
          <p className="muted small">
            <Icon name="alert-triangle" size={14} /> {warned.length} điểm có cảnh báo AI ({warned.map((p) => p.name).join(', ')}).
            Không chặn gửi duyệt; Admin sẽ xem các cảnh báo này.
          </p>
        ) : null}

        {readiness && !readiness.canPublish && !isPublic ? (
          <div className="alert" role="status">
            <Icon name="info" size={18} className="alert__icon" />
            <div>
              {status === 'restricted'
                ? `Tour đang ở chế độ truy cập hạn chế. Hãy tắt chế độ này (bên dưới) trước khi ${moderation ? 'gửi duyệt' : 'xuất bản'}.`
                : 'Tour đang bị quản trị viên ẩn hoặc hạn chế nên chưa thể tự xuất bản.'}
            </div>
          </div>
        ) : null}

        {zoneError ? <ForbiddenZoneDetails zone={zoneError} /> : null}
        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
            {!readiness ? <button className="btn btn--sm" onClick={() => { setError(''); load().catch(() => {}); }}>Thử lại</button> : null}
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
          {action}
        </div>
      </section>

      <ConfirmDialog
        open={confirmSubmit}
        title={`Gửi “${tour.title}” đi duyệt?`}
        message="AI sẽ kiểm duyệt nội dung và vị trí các điểm dừng, sau đó tour vào hàng chờ Admin duyệt. Tour chưa hiện với khách cho tới khi Admin phê duyệt."
        confirmLabel="Gửi duyệt"
        onConfirm={() => {
          setConfirmSubmit(false);
          run(publishTour, 'submit');
        }}
        onCancel={() => setConfirmSubmit(false)}
      />
    </>
  );
}
