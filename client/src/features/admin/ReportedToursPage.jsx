// =========================================================
// ReportedToursPage (/admin/reports) — UC20 queue of reported tours.
//   - Order comes from the API (R1): most open reports first, flagged first, oldest report first.
//   - Each row: title, status, open report count, "Đạt ngưỡng" flag, reasons summary, last report.
//   - Paging with ?page=N; loading / empty (E1) / error with retry.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { listReportedTours, reasonLabel, QUEUE_LIMIT } from '../../lib/admin-reports.js';
import { statusMeta } from '../../lib/studio.js';
import { formatDateTime } from '../../lib/format.js';
import { adminErrorMessage } from './admin-errors.js';

/** { spam: 2, other: 1 } -> "Spam 2 · Khác 1", biggest first. */
export function reasonsSummary(reasons = {}) {
  return Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${reasonLabel(r)} ${n}`)
    .join(' · ');
}

export function StatusChip({ status }) {
  const meta = statusMeta(status);
  return <span className={`statuschip statuschip--${meta.tone}`}>{meta.label}</span>;
}

function ReportQueue() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await listReportedTours({ page, limit: QUEUE_LIMIT }));
    } catch (e) {
      setError(adminErrorMessage(e, 'Chưa tải được danh sách tour bị báo cáo'));
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.limit || QUEUE_LIMIT)));
  const goTo = (p) => setParams(p > 1 ? { page: String(p) } : {});

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Tour bị báo cáo" backTo="/admin" />
      <AdminNav />

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {data === null ? (
        error ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : data.tours.length === 0 ? (
        <div className="card admin-empty">
          <Icon name="check-circle" size={28} />
          <b>Không có tour bị báo cáo</b>
          <span className="muted small">Khi du khách báo cáo một tour, tour đó sẽ xuất hiện ở đây.</span>
        </div>
      ) : (
        <>
          <p className="muted small">
            {total} tour có báo cáo đang mở · nhiều báo cáo nhất ở trên cùng
          </p>
          <ul className="admin-list" aria-label="Tour bị báo cáo">
            {data.tours.map((t) => (
              <li key={t.tourId}>
                <Link className="card admin-report" to={`/admin/reports/${encodeURIComponent(t.tourId)}`} data-testid="report-row">
                  <div className="admin-report__head">
                    <b className="admin-report__title">{t.title || 'Tour không tên'}</b>
                    <span className="admin-report__count" aria-label={`${t.openReportCount} báo cáo đang mở`}>
                      {t.openReportCount}
                    </span>
                  </div>
                  <div className="admin-report__chips">
                    <StatusChip status={t.status} />
                    {t.flagged ? <span className="statuschip statuschip--danger">Đạt ngưỡng</span> : null}
                  </div>
                  {reasonsSummary(t.reasons) ? (
                    <span className="small admin-report__reasons">{reasonsSummary(t.reasons)}</span>
                  ) : null}
                  {t.lastReportAt ? (
                    <span className="muted small">
                      Báo cáo gần nhất <time dateTime={t.lastReportAt}>{formatDateTime(t.lastReportAt)}</time>
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="admin-pager" aria-label="Phân trang">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                Trang trước
              </button>
              <span className="muted small">Trang {page}/{pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => goTo(page + 1)}>
                Trang sau
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ReportedToursPage() {
  return (
    <AdminGate title="Tour bị báo cáo">
      <ReportQueue />
    </AdminGate>
  );
}
