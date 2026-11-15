// =========================================================
// ReviewDossierPage (/admin/reviews/:tourId) — UC19 read-only dossier and decisions.
//   #123 dossier: tour info, AI / geo reasons (Vietnamese field + category labels), stops in
//        order with their text, images, audio and moderation status / reasons, route
//        configuration, review history. Read only: no rating / report / itinerary actions and no
//        content edit (admins only decide the status).
//   #124 approve: ConfirmDialog, then POST /approve.
//   #125 reject: ReasonDialog with a mandatory reason (1..1000); a 422 shows inside the dialog.
//   #126 request changes: RequestChangesDialog, general note + per-stop notes joined in one reason.
//   After a decision: toast and back to the queue. 409 / 404: "Tour không còn ở trạng thái chờ
//   duyệt" above the dossier and the dossier is reloaded.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import ReasonDialog from './ReasonDialog.jsx';
import RequestChangesDialog from './RequestChangesDialog.jsx';
import { StatusChip } from './ReportedToursPage.jsx';
import { ReviewStatusChip } from './ReviewQueuePage.jsx';
import { adminErrorMessage, OFFLINE_MESSAGE } from './admin-errors.js';
import {
  approveTour,
  categoryLabel,
  fieldLabel,
  getReviewDossier,
  NOT_REVIEWABLE_MESSAGE,
  placeModerationMeta,
  rejectTour,
  requestTourChanges,
  reviewActionLabel,
  sourceLabel,
} from '../../lib/admin-reviews.js';
import { formatDateTime, formatMinutes, langLabel } from '../../lib/format.js';
import { PLACE_TYPE_LABELS, statusMeta } from '../../lib/studio.js';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';

const DONE = {
  approve: 'Đã duyệt tour, tour đã công khai',
  reject: 'Đã từ chối tour',
  changes: 'Đã yêu cầu tác giả chỉnh sửa tour',
};

/** AI / geo findings: field, category, source, severity and the model's message. */
export function ReasonList({ reasons, testId = 'reason' }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return (
    <ul className="admin-list review-reasons">
      {reasons.map((r, i) => (
        <li key={`${r.field}-${i}`} className="admin-item" data-testid={testId}>
          <div className="admin-report__chips">
            <span className="chip">{fieldLabel(r.field)}</span>
            <span className="chip">{categoryLabel(r.category)}</span>
            {sourceLabel(r.source) ? <span className="muted small">{sourceLabel(r.source)}</span> : null}
            {typeof r.severity === 'number' ? (
              <span className="muted small">Mức độ {Math.round(r.severity * 100)}%</span>
            ) : null}
          </div>
          {r.message ? <p className="admin-item__text">{r.message}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function zoneText(zone) {
  if (!zone) return null;
  if (zone.shape === 'circle' && zone.radiusMeters) return `Vùng tròn bán kính ${Math.round(zone.radiusMeters)} m`;
  if (zone.shape === 'polygon') return 'Vùng đa giác';
  return null;
}

/** Read-only stop preview: text, images, audio (human recording or TTS), moderation. */
function StopPreview({ place, index, trigger }) {
  const mod = placeModerationMeta(place.moderationStatus);
  const zone = zoneText(trigger?.zone);
  return (
    <li className="card review-stop" data-testid="review-stop">
      <div className="admin-report__head">
        <b className="admin-report__title">
          <span className="stop__num review-stop__num">{index + 1}</span> {place.name || 'Điểm không tên'}
        </b>
        <span className={`statuschip statuschip--${mod.tone}`}>{mod.label}</span>
      </div>
      <span className="muted small">
        {[PLACE_TYPE_LABELS[place.type], zone].filter(Boolean).join(' · ') || 'Chưa có vùng kích hoạt'}
      </span>
      {place.description ? (
        <p className="admin-item__text small">{place.description}</p>
      ) : (
        <p className="muted small">Chưa có mô tả</p>
      )}
      {place.images?.length ? (
        <ul className="review-stop__images" aria-label={`Ảnh của điểm ${index + 1}`}>
          {place.images.map((img, i) => (
            <li key={`${img.url}-${i}`}>
              <a href={img.url} target="_blank" rel="noreferrer">
                <img src={img.url} alt={img.caption || `Ảnh ${i + 1} của ${place.name || 'điểm'}`} loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {place.audioUrl ? (
        <div className="review-stop__audio">
          <audio controls preload="none" src={place.audioUrl} aria-label={`Audio của ${place.name || 'điểm'}`} />
          <a className="small" href={place.audioUrl} target="_blank" rel="noreferrer">Mở file audio</a>
        </div>
      ) : (
        <span className="muted small">Giọng đọc máy (TTS) từ mô tả</span>
      )}
      <ReasonList reasons={place.moderationReasons} testId="place-reason" />
    </li>
  );
}

function Dossier() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null); // { message, notFound }
  const [notice, setNotice] = useState(null);
  const [decision, setDecision] = useState(null); // 'approve' | 'reject' | 'changes'
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getReviewDossier(tourId));
    } catch (e) {
      setData(null);
      setError({
        message: e?.status === 404 ? 'Không tìm thấy tour này' : adminErrorMessage(e, 'Chưa tải được hồ sơ duyệt'),
        notFound: e?.status === 404,
      });
    }
  }, [tourId]);

  useEffect(() => {
    load();
  }, [load]);

  function open(kind) {
    setNotice(null);
    setDialogError(null);
    setDecision(kind);
  }

  async function decide(kind, reason) {
    const run = { approve: () => approveTour(tourId), reject: () => rejectTour(tourId, reason), changes: () => requestTourChanges(tourId, reason) }[kind];
    setBusy(true);
    setDialogError(null);
    try {
      const res = await run();
      setDecision(null);
      toast.show(res?.message || DONE[kind]);
      navigate('/admin/reviews');
    } catch (e) {
      if (e?.status === 422 && kind !== 'approve') {
        setDialogError(e.message || 'Lý do không hợp lệ');
      } else if (e?.status === 409 || e?.status === 404) {
        setDecision(null);
        setNotice(NOT_REVIEWABLE_MESSAGE);
        await load();
      } else {
        const msg = e?.offline ? OFFLINE_MESSAGE : adminErrorMessage(e, 'Chưa thực hiện được thao tác');
        if (kind === 'approve') {
          setDecision(null);
          setNotice(msg);
        } else setDialogError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const tour = data?.tour;
  const places = data?.places || [];
  const route = data?.routeConfig;
  const history = data?.history || [];
  const triggers = new Map((route?.triggers || []).map((t) => [t.placeId, t]));
  const reviewable = !!data?.reviewable;

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Hồ sơ duyệt tour" subtitle={tour?.title} backTo="/admin/reviews" />
      <AdminNav />

      {notice ? (
        <div className="alert alert--warn" role="alert" data-testid="dossier-notice">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{notice}</div>
          <Link className="btn btn--sm" to="/admin/reviews">Về hàng chờ</Link>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error.message}</div>
          {error.notFound ? (
            <Link className="btn btn--sm" to="/admin/reviews">Về hàng chờ</Link>
          ) : (
            <button className="btn btn--sm" onClick={load}>Thử lại</button>
          )}
        </div>
      ) : null}

      {data === null ? (
        error ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : (
        <>
          <section className="card admin-dossier__tour" aria-label="Thông tin tour">
            {tour.coverImageUrl ? (
              <img className="review-cover" src={tour.coverImageUrl} alt={`Ảnh bìa ${tour.title || ''}`} loading="lazy" />
            ) : null}
            <div className="admin-report__head">
              <b className="admin-report__title">{tour.title || 'Tour không tên'}</b>
              {reviewable ? <ReviewStatusChip status={tour.status} aiWarning={tour.aiWarning} /> : <StatusChip status={tour.status} />}
            </div>
            <span className="muted small">
              {[
                tour.city,
                TOUR_TYPE_LABELS[tour.type],
                tour.duration ? formatMinutes(tour.duration) : null,
                tour.originalLanguage ? langLabel(tour.originalLanguage) : null,
                `${places.length} điểm`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {tour.description ? <p className="admin-dossier__desc small">{tour.description}</p> : <p className="muted small">Chưa có mô tả</p>}
            {tour.updatedAt ? (
              <span className="muted small">
                Gửi lúc <time dateTime={tour.updatedAt}>{formatDateTime(tour.updatedAt)}</time>
              </span>
            ) : null}
            {tour.authorId ? (
              <div className="row admin-dossier__links">
                <Link className="btn btn--ghost btn--sm" to={`/admin/users/${encodeURIComponent(tour.authorId)}`}>
                  <Icon name="user" size={16} /> Xem tài khoản tác giả
                </Link>
              </div>
            ) : null}
          </section>

          <section className="card admin-dossier__actions" aria-label="Quyết định">
            <h2 className="section-title">Quyết định</h2>
            {reviewable ? (
              <div className="row">
                <button className="btn btn--primary btn--sm" onClick={() => open('approve')}>
                  <Icon name="check-circle" size={16} /> Duyệt
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => open('changes')}>
                  <Icon name="edit" size={16} /> Yêu cầu chỉnh sửa
                </button>
                <button className="btn btn--danger btn--sm" onClick={() => open('reject')}>
                  <Icon name="x" size={16} /> Từ chối
                </button>
              </div>
            ) : (
              <p className="muted small" data-testid="not-reviewable">
                {NOT_REVIEWABLE_MESSAGE} (hiện tại: {statusMeta(tour.status).label}).
              </p>
            )}
          </section>

          <section className="card" aria-label="Kết quả kiểm duyệt AI">
            <h2 className="section-title">Kết quả kiểm duyệt AI</h2>
            {tour.moderationReasons?.length ? (
              <ReasonList reasons={tour.moderationReasons} testId="tour-reason" />
            ) : (
              <p className="muted small">AI không ghi nhận vấn đề nào ở cấp tour.</p>
            )}
            {tour.reviewReason ? (
              <p className="small">
                <b>Lý do lần duyệt trước:</b> {tour.reviewReason}
              </p>
            ) : null}
          </section>

          <section className="card" aria-label="Lộ trình">
            <h2 className="section-title">Lộ trình</h2>
            {route ? (
              <p className="small" data-testid="route-info">
                {route.path?.length || 0} điểm trên đường đi · {route.triggers?.length || 0} vùng kích hoạt ·{' '}
                {route.navAudios?.length || 0} audio chỉ đường
              </p>
            ) : (
              <p className="muted small" data-testid="route-info">Chưa cấu hình lộ trình</p>
            )}
            {route?.navAudios?.length ? (
              <ul className="admin-list">
                {route.navAudios.map((n) => (
                  <li key={n.id} className="admin-item">
                    <span className="small">{n.label || 'Audio chỉ đường'}</span>
                    {n.audioUrl ? (
                      <a className="small" href={n.audioUrl} target="_blank" rel="noreferrer">Mở file audio</a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-label="Các điểm dừng">
            <h2 className="section-title">Các điểm dừng ({places.length})</h2>
            {places.length ? (
              <ol className="admin-list review-stops">
                {places.map((p, i) => (
                  <StopPreview key={p.id} place={p} index={i} trigger={triggers.get(p.id)} />
                ))}
              </ol>
            ) : (
              <p className="muted small">Tour chưa có điểm dừng nào.</p>
            )}
          </section>

          <section className="card" aria-label="Lịch sử duyệt">
            <h2 className="section-title">Lịch sử duyệt</h2>
            {history.length === 0 ? (
              <p className="muted small">Chưa có quyết định nào.</p>
            ) : (
              <ul className="admin-list">
                {history.map((h) => (
                  <li key={h.id} className="admin-item" data-testid="history-row">
                    <div className="admin-report__head">
                      <b>{reviewActionLabel(h.action)}</b>
                      <time className="muted small" dateTime={h.createdAt}>{formatDateTime(h.createdAt)}</time>
                    </div>
                    {h.fromStatus ? <span className="muted small">Từ trạng thái: {statusMeta(h.fromStatus).label}</span> : null}
                    {h.reason ? <p className="admin-item__text">{h.reason}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={decision === 'approve' && !busy}
        title="Duyệt tour này?"
        message="Tour được công khai ngay, xuất hiện trong tìm kiếm và tác giả nhận thông báo."
        confirmLabel="Duyệt và công khai"
        onConfirm={() => decide('approve')}
        onCancel={() => setDecision(null)}
      />
      <ReasonDialog
        open={decision === 'reject'}
        title="Từ chối tour này?"
        message="Tour chuyển sang Bị từ chối. Tác giả nhận email kèm lý do và có thể sửa rồi gửi lại."
        confirmLabel="Từ chối tour"
        required
        danger
        busy={busy}
        error={dialogError}
        onConfirm={(reason) => decide('reject', reason)}
        onCancel={() => setDecision(null)}
      />
      <RequestChangesDialog
        open={decision === 'changes'}
        places={places}
        busy={busy}
        error={dialogError}
        onConfirm={(reason) => decide('changes', reason)}
        onCancel={() => setDecision(null)}
      />
    </div>
  );
}

export default function ReviewDossierPage() {
  return (
    <AdminGate title="Hồ sơ duyệt tour">
      <Dossier />
    </AdminGate>
  );
}
