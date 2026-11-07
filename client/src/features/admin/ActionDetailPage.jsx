// =========================================================
// ActionDetailPage (/admin/actions/:id) — UC22 one row of the admin action log, read-only.
//   The log is append-only (R1): no edit or delete control exists. `data` is shown as labelled
//   fields; unknown keys are shown as they are. 404 -> "Không tìm thấy bản ghi".
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import { TargetLink } from './ActionLogPage.jsx';
import { adminErrorMessage } from './admin-errors.js';
import { ACTION_DATA_LABELS, TARGET_TYPE_LABELS, getAdminAction } from '../../lib/admin-dashboard.js';
import { actionLabel } from '../../lib/admin-reports.js';
import { statusMeta } from '../../lib/studio.js';
import { formatDateTime } from '../../lib/format.js';

const NOT_FOUND = 'Không tìm thấy bản ghi';

/** Human value of one `data` field. */
function dataValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'fromStatus' || key === 'status') return statusMeta(value).label;
  if (key === 'queuedAt' || key === 'until') return formatDateTime(value) || String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ActionDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null); // { message, notFound }

  const load = useCallback(async () => {
    setError(null);
    try {
      setItem(await getAdminAction(id));
    } catch (e) {
      setItem(null);
      const notFound = e?.status === 404;
      setError({ message: notFound ? NOT_FOUND : adminErrorMessage(e, 'Chưa tải được bản ghi'), notFound });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const data = item?.data && typeof item.data === 'object' ? Object.entries(item.data) : [];

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Chi tiết hành động" backTo="/admin/actions" />
      <AdminNav />

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{error.message}</div>
          {error.notFound ? (
            <Link className="btn btn--sm" to="/admin/actions">Về nhật ký</Link>
          ) : (
            <button className="btn btn--sm" onClick={load}>Thử lại</button>
          )}
        </div>
      ) : null}

      {item === null ? (
        error ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : (
        <section className="card admin-dossier__tour" aria-label="Bản ghi nhật ký">
          <div className="admin-report__head">
            <b className="admin-report__title">{actionLabel(item.action)}</b>
            <time className="muted small" dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
          </div>
          <p className="muted small admin-readonly">
            <Icon name="info" size={14} /> Nhật ký không thể sửa hoặc xoá
          </p>
          <dl className="admin-fields">
            {[
              ['Mã bản ghi', <span className="admin-table__sub">{item.id}</span>],
              [
                'Đối tượng',
                <>
                  {TARGET_TYPE_LABELS[item.targetType] || item.targetType}: <TargetLink type={item.targetType} id={item.targetId} />
                </>,
              ],
              ['Quản trị viên', <span className="admin-table__sub">{item.adminId}</span>],
              ['Lý do', <span className="admin-item__text">{item.reason || '—'}</span>],
            ].map(([label, value]) => (
              <div key={label} className="admin-fields__pair">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            {data.map(([k, v]) => (
              <div key={k} className="admin-fields__pair" data-testid="action-data">
                <dt>{ACTION_DATA_LABELS[k] || k}</dt>
                <dd>{dataValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

export default function ActionDetailPage() {
  return (
    <AdminGate title="Chi tiết hành động">
      <ActionDetail />
    </AdminGate>
  );
}
