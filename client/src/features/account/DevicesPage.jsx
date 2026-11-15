// =========================================================
// DevicesPage (/account/devices) - UC23 "Thiết bị đang đăng nhập".
//   - List: current device first ("Thiết bị này"), others by last activity.
//   - Sign out one device (confirm) or all other devices (confirm with count).
//   - E1: only this device -> hide "Đăng xuất tất cả thiết bị khác".
//   - E2: 404 (already signed out) -> notice and reload the list.
//   - E3: network error -> notice, list unchanged.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { listSessions, revokeSession, revokeOtherSessions } from '../../lib/sessions.js';
import { formatDateTime, formatLastActive } from '../../lib/format.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const ALREADY_SIGNED_OUT = 'Thiết bị này đã đăng xuất';

const nameOf = (s) => s.deviceName || 'Thiết bị không rõ';

/** Current device first, then the most recently active. */
function sortSessions(list) {
  const time = (s) => new Date(s.lastActiveAt).getTime() || 0;
  return [...list].sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || time(b) - time(a));
}

function errorMessage(err, fallback) {
  return err?.offline ? OFFLINE_MESSAGE : err?.message || fallback;
}

export default function DevicesPage() {
  const toast = useToast();
  const [list, setList] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'one', session } | { kind: 'others', count }

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(sortSessions(await listSessions()));
    } catch (e) {
      setError(errorMessage(e, 'Chưa tải được danh sách thiết bị'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const others = list ? list.filter((s) => !s.current) : [];

  async function onRevokeOne(session) {
    setBusy(true);
    try {
      await revokeSession(session.id);
      setList((cur) => (cur ? cur.filter((s) => s.id !== session.id) : cur));
      toast.show(`Đã đăng xuất ${nameOf(session)}`);
    } catch (e) {
      if (e?.status === 404) {
        toast.show(ALREADY_SIGNED_OUT);
        await load();
      } else {
        toast.show(errorMessage(e, 'Chưa đăng xuất được thiết bị'), { tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeOthers() {
    setBusy(true);
    try {
      const revoked = await revokeOtherSessions();
      setList((cur) => (cur ? cur.filter((s) => s.current) : cur));
      toast.show(`Đã đăng xuất ${revoked} thiết bị`);
    } catch (e) {
      toast.show(errorMessage(e, 'Chưa đăng xuất được các thiết bị khác'), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  function onConfirm() {
    const c = confirm;
    setConfirm(null);
    if (c?.kind === 'one') onRevokeOne(c.session);
    else if (c?.kind === 'others') onRevokeOthers();
  }

  return (
    <div className="page page--narrow devices">
      <AppHeader title="Thiết bị đang đăng nhập" backTo="/account" />

      {error ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={error === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{error}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      {list === null ? (
        error ? null : (
          <p className="muted devices__loading">
            <Icon name="loader" size={18} className="spin" /> Đang tải…
          </p>
        )
      ) : (
        <>
          <p className="muted small">
            Đây là các thiết bị đang đăng nhập tài khoản của bạn. Đăng xuất thiết bị bạn không nhận ra.
          </p>
          <ul className="devices__list" aria-label="Danh sách thiết bị">
            {list.map((s) => {
              const lastActive = formatLastActive(s.lastActiveAt);
              return (
                <li key={s.id} className="card device" data-testid="device-row">
                  <div className="device__head">
                    <Icon name={s.current ? 'check-circle' : 'user'} size={20} className="device__icon" />
                    <b className="device__name">{nameOf(s)}</b>
                    {s.current ? <span className="chip chip--live">Thiết bị này</span> : null}
                  </div>
                  <span className="muted small device__meta">
                    <Icon name="map-pin" size={14} /> {s.location || 'Không xác định'}
                  </span>
                  {s.createdAt ? (
                    <span className="muted small device__meta">
                      <Icon name="clock" size={14} /> Đăng nhập lúc{' '}
                      <time dateTime={s.createdAt}>{formatDateTime(s.createdAt)}</time>
                    </span>
                  ) : null}
                  {lastActive ? (
                    <span className={`small device__meta ${lastActive === 'Đang hoạt động' ? 'device__active' : 'muted'}`}>
                      {lastActive}
                    </span>
                  ) : null}
                  {s.current ? null : (
                    <button
                      className="btn btn--ghost btn--sm device__signout"
                      disabled={busy}
                      onClick={() => setConfirm({ kind: 'one', session: s })}
                      aria-label={`Đăng xuất thiết bị ${nameOf(s)}`}
                    >
                      Đăng xuất thiết bị
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* E1: only this device -> no "sign out all others". */}
          {others.length > 0 ? (
            <button
              className="btn btn--ghost btn--block account-logout"
              disabled={busy}
              onClick={() => setConfirm({ kind: 'others', count: others.length })}
            >
              Đăng xuất tất cả thiết bị khác
            </button>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        danger
        title={
          confirm?.kind === 'one'
            ? `Đăng xuất khỏi ${nameOf(confirm.session)}?`
            : `Đăng xuất ${confirm?.count ?? 0} thiết bị khác?`
        }
        message={
          confirm?.kind === 'one'
            ? 'Thiết bị đó sẽ cần đăng nhập lại để tiếp tục dùng tài khoản.'
            : `${confirm?.count ?? 0} thiết bị sẽ bị đăng xuất. Thiết bị này vẫn giữ đăng nhập.`
        }
        confirmLabel="Đăng xuất"
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
