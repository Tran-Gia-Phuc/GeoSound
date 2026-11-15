// =========================================================
// UserDetailPage (/admin/users/:id) — UC21 account details and account actions.
//   - Account (Auth): name, email, role, status (active / suspended until / banned + reason),
//     signed-in devices.
//   - Violation history (Tour): tours by status, hidden and rejected tours (links to the UC20
//     dossier), reports received, latest account actions.
//   - Actions in a ReasonDialog: warn, suspend (1 / 7 / 30 days or an end date, max 365 days),
//     ban (danger) — reason required; restore (reason optional, only when suspended / banned).
//     Never offered on the admin's own account or on another admin (the API answers 403 anyway).
//   - 403 / 404 / 409 from an action: message shown above the page, data reloaded.
// =========================================================
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import AdminGate from './AdminGate.jsx';
import AdminNav from './AdminNav.jsx';
import ReasonDialog from './ReasonDialog.jsx';
import { AccountStatusChip } from './UsersPage.jsx';
import { adminErrorMessage, OFFLINE_MESSAGE } from './admin-errors.js';
import {
  SUSPEND_MAX_DAYS,
  SUSPEND_PRESETS,
  banUser,
  endOfLocalDay,
  getUser,
  getUserViolations,
  restoreUser,
  roleLabel,
  suspendUser,
  toLocalDate,
  warnUser,
} from '../../lib/admin-users.js';
import { actionLabel } from '../../lib/admin-reports.js';
import { formatDateTime } from '../../lib/format.js';

const DAY_MS = 86_400_000;
const NOT_FOUND = 'Không tìm thấy tài khoản';

const DECISIONS = {
  warn: {
    title: 'Cảnh báo tài khoản?',
    message: 'Người dùng nhận email và thông báo kèm lý do. Trạng thái tài khoản không đổi.',
    confirmLabel: 'Gửi cảnh báo',
    required: true,
    done: 'Đã gửi cảnh báo',
  },
  suspend: {
    title: 'Tạm khoá tài khoản?',
    message: 'Tài khoản bị đăng xuất khỏi mọi thiết bị và không đăng nhập được đến hết thời hạn.',
    confirmLabel: 'Tạm khoá',
    required: true,
    danger: true,
    done: 'Đã tạm khoá tài khoản',
  },
  ban: {
    title: 'Cấm vĩnh viễn tài khoản?',
    message: 'Tài khoản bị đăng xuất khỏi mọi thiết bị và không thể đăng nhập lại cho đến khi được khôi phục.',
    confirmLabel: 'Cấm tài khoản',
    required: true,
    danger: true,
    done: 'Đã cấm tài khoản',
  },
  restore: {
    title: 'Khôi phục tài khoản?',
    message: 'Tài khoản hoạt động lại bình thường và có thể đăng nhập ngay.',
    confirmLabel: 'Khôi phục',
    done: 'Đã khôi phục tài khoản',
  },
};

/** Which actions apply to an account in this status (A1, R8). */
function actionsFor(status) {
  if (status === 'banned') return ['restore'];
  if (status === 'suspended') return ['warn', 'suspend', 'ban', 'restore'];
  return ['warn', 'suspend', 'ban'];
}

const ACTION_BUTTONS = {
  warn: { label: 'Cảnh báo', icon: 'alert-triangle', cls: 'btn--ghost' },
  suspend: { label: 'Tạm khoá', icon: 'clock', cls: 'btn--ghost' },
  ban: { label: 'Cấm tài khoản', icon: 'x', cls: 'btn--danger' },
  restore: { label: 'Khôi phục', icon: 'check-circle', cls: 'btn--primary' },
};

/** Duration picker of the suspend dialog: presets or an end date. */
function SuspendLength({ mode, setMode, date, setDate }) {
  const id = useId();
  const today = new Date();
  const min = toLocalDate(today);
  const max = toLocalDate(new Date(today.getTime() + SUSPEND_MAX_DAYS * DAY_MS - DAY_MS));
  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>Thời hạn tạm khoá</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
        {[...SUSPEND_PRESETS.map(String), 'date'].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            className={`segmented__item ${mode === v ? 'is-active' : ''}`}
            onClick={() => setMode(v)}
          >
            {v === 'date' ? 'Chọn ngày' : `${v} ngày`}
          </button>
        ))}
      </div>
      {mode === 'date' ? (
        <>
          <label className="field__label" htmlFor={`${id}-until`}>Khoá đến hết ngày</label>
          <input
            id={`${id}-until`}
            className="input"
            type="date"
            min={min}
            max={max}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <span className="field__hint">Tối đa {SUSPEND_MAX_DAYS} ngày kể từ hôm nay</span>
        </>
      ) : null}
    </div>
  );
}

function UserDetail() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const toast = useToast();

  const [user, setUser] = useState(null); // null = loading
  const [userError, setUserError] = useState(null); // { message, notFound }
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [mode, setMode] = useState('7');
  const [date, setDate] = useState('');

  const loadUser = useCallback(async () => {
    setUserError(null);
    try {
      setUser(await getUser(id));
    } catch (e) {
      setUser(null);
      const notFound = e?.status === 404;
      setUserError({ message: notFound ? NOT_FOUND : adminErrorMessage(e, 'Chưa tải được tài khoản'), notFound });
    }
  }, [id]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory(await getUserViolations(id));
    } catch (e) {
      setHistory(null);
      setHistoryError(adminErrorMessage(e, 'Chưa tải được lịch sử vi phạm'));
    }
  }, [id]);

  const reload = useCallback(() => Promise.all([loadUser(), loadHistory()]), [loadUser, loadHistory]);

  useEffect(() => {
    reload();
  }, [reload]);

  function open(kind) {
    setNotice(null);
    setDialogError(null);
    setMode('7');
    setDate('');
    setDecision(kind);
  }

  function validateSuspend() {
    if (mode !== 'date') return null;
    const until = endOfLocalDay(date);
    if (!until) return 'Vui lòng chọn ngày kết thúc';
    const t = new Date(until).getTime();
    if (t <= Date.now()) return 'Ngày kết thúc phải ở tương lai';
    if (t > Date.now() + SUSPEND_MAX_DAYS * DAY_MS) return `Tạm khoá tối đa ${SUSPEND_MAX_DAYS} ngày`;
    return null;
  }

  async function onConfirm(reason) {
    const d = DECISIONS[decision];
    setBusy(true);
    setDialogError(null);
    try {
      let res;
      if (decision === 'warn') res = await warnUser(id, reason);
      else if (decision === 'ban') res = await banUser(id, reason);
      else if (decision === 'restore') res = await restoreUser(id, reason);
      else
        res = await suspendUser(
          id,
          mode === 'date' ? { reason, until: endOfLocalDay(date) } : { reason, days: Number(mode) },
        );
      setDecision(null);
      toast.show(res?.message || d.done);
      await reload();
    } catch (e) {
      if (e?.status === 422) {
        setDialogError(e.message || 'Dữ liệu không hợp lệ');
      } else if (e?.status === 403 || e?.status === 404 || e?.status === 409) {
        setDecision(null);
        setNotice(e.status === 404 ? NOT_FOUND : e.message || 'Tài khoản vừa được cập nhật, vui lòng tải lại');
        await reload();
      } else {
        setDialogError(e?.offline ? OFFLINE_MESSAGE : adminErrorMessage(e, 'Chưa thực hiện được thao tác'));
      }
    } finally {
      setBusy(false);
    }
  }

  const isSelf = user && me?.id === user.id;
  const isAdminTarget = user?.role === 'admin';
  const d = decision ? DECISIONS[decision] : null;

  return (
    <div className="page page--narrow admin-page">
      <AppHeader title="Chi tiết tài khoản" subtitle={user?.email} backTo="/admin/users" />
      <AdminNav />

      {notice ? (
        <div className="alert alert--warn" role="alert" data-testid="user-notice">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>{notice}</div>
        </div>
      ) : null}

      {userError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={userError.message === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{userError.message}</div>
          {userError.notFound ? (
            <Link className="btn btn--sm" to="/admin/users">Về danh sách</Link>
          ) : (
            <button className="btn btn--sm" onClick={loadUser}>Thử lại</button>
          )}
        </div>
      ) : null}

      {user === null ? (
        userError ? null : (
          <p className="muted">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : (
        <>
          <section className="card admin-dossier__tour" aria-label="Thông tin tài khoản">
            <div className="admin-report__head">
              <b className="admin-report__title">{user.fullName || 'Chưa đặt tên'}</b>
              <AccountStatusChip status={user.status} />
            </div>
            <span className="muted small admin-table__sub">{user.email}</span>
            <span className="muted small">
              {roleLabel(user.role)}
              {user.createdAt ? ` · tạo lúc ${formatDateTime(user.createdAt)}` : ''}
            </span>
            {user.status === 'suspended' && user.suspendedUntil ? (
              <span className="small" data-testid="suspended-until">
                Tạm khoá đến <time dateTime={user.suspendedUntil}>{formatDateTime(user.suspendedUntil)}</time>
              </span>
            ) : null}
            {user.banReason ? <p className="admin-item__text small">Lý do: {user.banReason}</p> : null}
            <span className="muted small" data-testid="active-sessions">
              <Icon name="user" size={14} /> {user.activeSessions ?? 0} thiết bị đang đăng nhập
            </span>
          </section>

          <section className="card admin-dossier__actions" aria-label="Xử lý tài khoản">
            <h2 className="section-title">Xử lý</h2>
            {isSelf ? (
              <p className="muted small">Đây là tài khoản của bạn: không thể tự xử lý.</p>
            ) : isAdminTarget ? (
              <p className="muted small">Không thể xử lý tài khoản quản trị viên.</p>
            ) : (
              <div className="row">
                {actionsFor(user.status).map((k) => {
                  const b = ACTION_BUTTONS[k];
                  return (
                    <button key={k} className={`btn btn--sm ${b.cls}`} onClick={() => open(k)}>
                      <Icon name={b.icon} size={16} /> {b.label}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {user || !userError?.notFound ? (
        <section className="card" aria-label="Lịch sử vi phạm">
          <h2 className="section-title">Lịch sử vi phạm</h2>
          {historyError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{historyError}</div>
              <button className="btn btn--sm" onClick={loadHistory}>Thử lại</button>
            </div>
          ) : history === null ? (
            <p className="muted small">
              <Icon name="loader" size={16} className="spin" /> Đang tải…
            </p>
          ) : (
            <ViolationHistory history={history} />
          )}
        </section>
      ) : null}

      <ReasonDialog
        open={!!d}
        title={d?.title || ''}
        message={d?.message}
        confirmLabel={d?.confirmLabel || ''}
        required={!!d?.required}
        danger={!!d?.danger}
        busy={busy}
        error={dialogError}
        validate={decision === 'suspend' ? validateSuspend : undefined}
        onConfirm={onConfirm}
        onCancel={() => setDecision(null)}
      >
        {decision === 'suspend' ? <SuspendLength mode={mode} setMode={setMode} date={date} setDate={setDate} /> : null}
      </ReasonDialog>
    </div>
  );
}

function ViolationHistory({ history }) {
  const tours = history.tours || {};
  const reports = history.reports || {};
  const tourList = (list, timeKey, label) =>
    list?.length ? (
      <>
        <h3 className="admin-subtitle">{label}</h3>
        <ul className="admin-list">
          {list.map((t) => (
            <li key={t.id} className="admin-item" data-testid={`${timeKey}-tour`}>
              <div className="admin-report__head">
                <Link to={`/admin/reports/${encodeURIComponent(t.id)}`}>{t.title || 'Tour không tên'}</Link>
                {t[timeKey] ? <time className="muted small" dateTime={t[timeKey]}>{formatDateTime(t[timeKey])}</time> : null}
              </div>
              {t.reason ? <p className="admin-item__text small">{t.reason}</p> : null}
            </li>
          ))}
        </ul>
      </>
    ) : null;

  return (
    <div className="admin-history">
      <div className="admin-stats" aria-label="Tour của tài khoản">
        <Stat label="Tour" value={tours.total} />
        <Stat label="Công khai" value={tours.public} />
        <Stat label="Đang ẩn" value={tours.hidden} />
        <Stat label="Bị từ chối" value={tours.rejected} />
      </div>
      <p className="muted small" data-testid="reports-received">
        Báo cáo nhận được: {reports.open ?? 0} đang mở · {reports.dismissed ?? 0} đã bỏ qua · {reports.actioned ?? 0} đã xử lý
      </p>
      {tourList(history.hiddenTours, 'hiddenAt', 'Tour bị ẩn')}
      {tourList(history.rejectedTours, 'rejectedAt', 'Tour bị từ chối')}
      <h3 className="admin-subtitle">Xử lý tài khoản gần đây</h3>
      {history.accountActions?.length ? (
        <ul className="admin-list">
          {history.accountActions.map((a) => (
            <li key={a.id} className="admin-item" data-testid="account-action">
              <div className="admin-report__head">
                <b>{actionLabel(a.action)}</b>
                <time className="muted small" dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
              </div>
              {a.data?.until ? <span className="muted small">Đến {formatDateTime(a.data.until)}</span> : null}
              {a.reason ? <p className="admin-item__text small">{a.reason}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Chưa có xử lý nào.</p>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card admin-stat" data-testid="violation-stat">
      <span className="muted small">{label}</span>
      <b className="admin-stat__value">{value ?? 0}</b>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <AdminGate title="Chi tiết tài khoản">
      <UserDetail />
    </AdminGate>
  );
}
