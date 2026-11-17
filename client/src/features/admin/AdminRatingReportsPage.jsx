// =========================================================
// UC05 — Admin queue for reported tour ratings (/admin/reports/ratings).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDateTime } from '../../lib/format.js';
import {
  RATING_REPORT_REASONS,
  listAdminRatingReports,
  resolveRatingReport,
} from '../../lib/rating-reports.js';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';

const STATUS_TABS = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'resolved', label: 'Đã gỡ bỏ' },
  { value: 'dismissed', label: 'Đã bác bỏ' },
];

const REASON_LABELS = Object.fromEntries(RATING_REPORT_REASONS.map((r) => [r.value, r.label]));

export default function AdminRatingReportsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(null); // { report, action }
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await listAdminRatingReports({ status, page: 1, limit: 20 }));
    } catch (e) {
      setError(e?.offline ? 'Không thể kết nối, vui lòng thử lại' : e?.message || 'Chưa tải được danh sách báo cáo');
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmResolve(e) {
    e.preventDefault();
    if (!resolving) return;
    setBusy(true);
    try {
      await resolveRatingReport(resolving.report.id, {
        action: resolving.action,
        adminNote,
      });
      toast.show('Đã xử lý báo cáo thành công');
      setResolving(null);
      setAdminNote('');
      await load();
    } catch (err) {
      toast.show(err?.message || 'Chưa xử lý được báo cáo', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminGate title="Khiếu nại đánh giá">
      <div className="page">
        <AppHeader title="Khiếu nại đánh giá" backTo="/admin" />
        <AdminNav />

        <div className="segmented" role="tablist" aria-label="Lọc trạng thái báo cáo" style={{ marginBottom: 16 }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              className={`segmented__item${status === t.value ? ' is-active' : ''}`}
              onClick={() => setStatus(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>{error}</div>
            <button type="button" className="btn btn--sm" onClick={load}>
              Thử lại
            </button>
          </div>
        ) : !data ? (
          <p className="muted small">
            <Icon name="loader" size={16} className="spin" /> Đang tải hàng đợi báo cáo…
          </p>
        ) : data.items.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <p className="muted">Không có báo cáo nào ở trạng thái này.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {data.items.map((rep) => (
              <article key={rep.id} className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b>{rep.tour?.title || 'Tour không xác định'}</b>
                    {rep.rating?.isFlagged ? (
                      <span className="chip" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}>
                        Cờ cảnh báo ({rep.pendingCount} báo cáo)
                      </span>
                    ) : null}
                    {rep.reporterRole === 'AUTHOR' ? (
                      <span className="chip">Khiếu nại từ Tác giả</span>
                    ) : null}
                  </div>
                  <span className="muted small">{formatDateTime(rep.createdAt)}</span>
                </div>

                <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-2)' }}>
                  <p className="small" style={{ marginBottom: 4 }}>
                    <b>{rep.rating?.userName || 'Người dùng GeoSound'}</b> · {rep.rating?.stars ?? '—'} sao
                  </p>
                  <p>{rep.rating?.comment || <span className="muted small">(Không có nhận xét)</span>}</p>
                </div>

                <p className="small">
                  <b>Lý do:</b> {REASON_LABELS[rep.reasonType] || rep.reasonType}
                  {rep.description ? ` — ${rep.description}` : ''}
                </p>

                {rep.adminNote ? (
                  <p className="muted small">
                    <b>Ghi chú xử lý:</b> {rep.adminNote}
                  </p>
                ) : null}

                {status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setAdminNote('');
                        setResolving({ report: rep, action: 'DISMISS' });
                      }}
                    >
                      Bác bỏ báo cáo
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => {
                        setAdminNote('');
                        setResolving({ report: rep, action: 'REMOVE_RATING' });
                      }}
                    >
                      Gỡ bỏ đánh giá
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <Modal
          open={!!resolving}
          onClose={busy ? undefined : () => setResolving(null)}
          title={resolving?.action === 'REMOVE_RATING' ? 'Xác nhận gỡ bỏ đánh giá?' : 'Xác nhận bác bỏ báo cáo?'}
        >
          <form onSubmit={confirmResolve} style={{ display: 'grid', gap: 12 }}>
            <p className="small muted">
              {resolving?.action === 'REMOVE_RATING'
                ? 'Đánh giá sẽ bị ẩn khỏi trang công khai và điểm trung bình của tour sẽ được tính lại.'
                : 'Đánh giá vẫn giữ nguyên hiển thị và các báo cáo đang chờ sẽ được đóng.'}
            </p>
            <label className="field">
              <span className="field__label">Ghi chú xử lý (không bắt buộc)</span>
              <textarea
                className="input"
                rows={3}
                maxLength={500}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Nhập ghi chú nội bộ..."
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setResolving(null)} disabled={busy}>
                Huỷ
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? <Icon name="loader" size={16} className="spin" /> : null}
                Xác nhận
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AdminGate>
  );
}
