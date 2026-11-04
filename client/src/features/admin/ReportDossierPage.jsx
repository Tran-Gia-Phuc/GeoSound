// =========================================================
// ReportDossierPage (/admin/reports/:tourId) — UC20 dossier of one reported tour.
//   - Tour summary (status, city, rating), link to the public tour and to the author's account (UC21).
//   - Open reports (reason, note, time, reporter id), counts of dismissed / actioned reports.
//   - Decisions offered by the API `actions` hint: hide (reason required), restore, dismiss
//     (reason optional); each confirmed in a dialog. 409 (another admin acted first): the
//     message is shown and the dossier reloaded. History of admin actions, newest first.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import ReasonDialog from './ReasonDialog.jsx';
import { StatusChip } from './ReportedToursPage.jsx';
import { adminErrorMessage, OFFLINE_MESSAGE } from './admin-errors.js';
import {
  actionLabel,
  dismissTourReports,
  getReportDossier,
  hideReportedTour,
  reasonLabel,
  restoreReportedTour,
} from '../../lib/admin-reports.js';
import { formatDateTime } from '../../lib/format.js';

const DECISIONS = {
  hide: {
    title: 'Ẩn tour này?',
    message: 'Tour sẽ không còn công khai, các báo cáo đang mở được đánh dấu đã xử lý và tác giả nhận email kèm lý do.',
    confirmLabel: 'Ẩn tour',
    required: true,
    danger: true,
    run: hideReportedTour,
    done: 'Đã ẩn tour',
  },
  restore: {
    title: 'Khôi phục tour?',
    message: 'Tour được công khai lại ngay, không cần duyệt lại.',
    confirmLabel: 'Khôi phục',
    run: restoreReportedTour,
    done: 'Đã khôi phục tour',
  },
  dismiss: {
    title: 'Bỏ qua các báo cáo?',
    message: 'Các báo cáo đang mở được đóng vì không có vi phạm. Trạng thái tour giữ nguyên.',
    confirmLabel: 'Bỏ qua báo cáo',
    run: dismissTourReports,
    done: 'Đã bỏ qua báo cáo',
  },
};

function Dossier() {
  const { tourId } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null); // { message, notFound }
  const [notice, setNotice] = useState(null); // 409 message shown above the dossier
  const [decision, setDecision] = useState(null); // 'hide' | 'restore' | 'dismiss'
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getReportDossier(tourId));
    } catch (e) {
      setData(null);
      setError({
        message: e?.status === 404 ? 'Không tìm thấy tour này' : adminErrorMessage(e, 'Chưa tải được hồ sơ báo cáo'),
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

  async function onConfirm(reason) {
    const d = DECISIONS[decision];
    setBusy(true);
    setDialogError(null);
    try {
      const res = await d.run(tourId, reason);
      setDecision(null);
      toast.show(res?.message || d.done);
      await load();
    } catch (e) {
      if (e?.status === 422) {
        setDialogError(e.message || 'Lý do không hợp lệ');
      } else if (e?.status === 409 || e?.status === 404) {
        setDecision(null);
        setNotice(e.message || 'Tour vừa được cập nhật bởi thao tác khác, vui lòng tải lại');
        await load();
      } else {
        setDialogError(e?.offline ? OFFLINE_MESSAGE : adminErrorMessage(e, 'Chưa thực hiện được thao tác'));
      }
    } finally {
      setBusy(false);
    }
  }

  const tour = data?.tour;
  const reports = data?.reports;
  const actions = data?.actions || {};
  const d = decision ? DECISIONS[decision] : null;

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Hồ sơ báo cáo" subtitle={tour?.title} backTo="/admin/reports" />
      <AdminNav />

      {notice ? (
        <div className="alert alert--warn" role="alert" data-testid="dossier-notice">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{notice}</div>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error.message}</div>
          {error.notFound ? (
            <Link className="btn btn--sm" to="/admin/reports">Về danh sách</Link>
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
            <div className="admin-report__head">
              <b className="admin-report__title">{tour.title || 'Tour không tên'}</b>
              <StatusChip status={tour.status} />
            </div>
            <span className="muted small">
              {[tour.city, tour.ratingCount ? `★ ${Number(tour.averageRating || 0).toFixed(1)} (${tour.ratingCount} đánh giá)` : 'Chưa có đánh giá']
                .filter(Boolean)
                .join(' · ')}
            </span>
            {tour.description ? <p className="admin-dossier__desc small">{tour.description}</p> : null}
            <div className="row admin-dossier__links">
              <Link className="btn btn--ghost btn--sm" to={`/tour/${encodeURIComponent(tour.id)}`}>
                <Icon name="eye" size={16} /> Xem trang tour
              </Link>
              {tour.authorId ? (
                <Link className="btn btn--ghost btn--sm" to={`/admin/users/${encodeURIComponent(tour.authorId)}`}>
                  <Icon name="user" size={16} /> Xem tài khoản tác giả
                </Link>
              ) : null}
            </div>
          </section>

          <section className="card admin-dossier__actions" aria-label="Xử lý">
            <h2 className="section-title">Xử lý</h2>
            {actions.hide || actions.restore || actions.dismiss ? (
              <div className="row">
                {actions.hide ? (
                  <button className="btn btn--danger btn--sm" onClick={() => open('hide')}>
                    <Icon name="eye-off" size={16} /> Ẩn tour
                  </button>
                ) : null}
                {actions.restore ? (
                  <button className="btn btn--primary btn--sm" onClick={() => open('restore')}>
                    <Icon name="eye" size={16} /> Khôi phục
                  </button>
                ) : null}
                {actions.dismiss ? (
                  <button className="btn btn--ghost btn--sm" onClick={() => open('dismiss')}>
                    <Icon name="check-circle" size={16} /> Bỏ qua báo cáo
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="muted small">Không có thao tác nào cho trạng thái hiện tại của tour.</p>
            )}
          </section>

          <section className="card" aria-label="Báo cáo đang mở">
            <div className="admin-report__head">
              <h2 className="section-title">Báo cáo đang mở ({reports.openReportCount})</h2>
              {reports.flagged ? <span className="statuschip statuschip--danger">Đạt ngưỡng</span> : null}
            </div>
            <p className="muted small" data-testid="report-counts">
              Đã bỏ qua {reports.dismissedCount} · Đã xử lý {reports.actionedCount}
            </p>
            {reports.open.length === 0 ? (
              <p className="muted small">Không còn báo cáo nào đang mở.</p>
            ) : (
              <ul className="admin-list">
                {reports.open.map((r) => (
                  <li key={r.id} className="admin-item" data-testid="open-report">
                    <div className="admin-report__head">
                      <span className="chip">{reasonLabel(r.reason)}</span>
                      <time className="muted small" dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                    </div>
                    {r.note ? <p className="admin-item__text">{r.note}</p> : <p className="muted small">Không có ghi chú</p>}
                    {r.reporterId ? <span className="muted small admin-table__sub">Người báo cáo: {r.reporterId}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-label="Lịch sử xử lý">
            <h2 className="section-title">Lịch sử xử lý</h2>
            {data.history.length === 0 ? (
              <p className="muted small">Chưa có thao tác nào.</p>
            ) : (
              <ul className="admin-list">
                {data.history.map((h) => (
                  <li key={h.id} className="admin-item" data-testid="history-row">
                    <div className="admin-report__head">
                      <b>{actionLabel(h.action)}</b>
                      <time className="muted small" dateTime={h.createdAt}>{formatDateTime(h.createdAt)}</time>
                    </div>
                    {h.reason ? <p className="admin-item__text">{h.reason}</p> : null}
                    {h.data?.reportCount ? (
                      <span className="muted small">{h.data.reportCount} báo cáo được đóng</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ReasonDialog
        open={!!d}
        title={d?.title || ''}
        message={d?.message}
        confirmLabel={d?.confirmLabel || ''}
        required={!!d?.required}
        danger={!!d?.danger}
        busy={busy}
        error={dialogError}
        onConfirm={onConfirm}
        onCancel={() => setDecision(null)}
      />
    </div>
  );
}

export default function ReportDossierPage() {
  return (
    <AdminGate title="Hồ sơ báo cáo">
      <Dossier />
    </AdminGate>
  );
}
