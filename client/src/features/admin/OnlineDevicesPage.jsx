// =========================================================
// OnlineDevicesPage (/admin/devices) — #265, UC23 R13 for admins.
//   - Counts (#329: visitors who are not signed in count too): devices online now (signed in +
//     guests), guests online, accounts online, signed in, devices seen today / 7 / 30 days,
//     signed-in devices known (kept 30 days). Without presence data (Redis down) "online" falls
//     back to signed-in devices and says so.
//   - Table of signed-in online devices: device, account, location, signed in at, last activity;
//     guests have no row (no account), only a count under the table.
//   - Refreshes every 30 s; non-admins see a notice (the API answers 403 anyway).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import AdminNav from './AdminNav.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getOnlineDevices } from '../../lib/sessions.js';
import { formatDateTime, formatLastActive } from '../../lib/format.js';

export const REFRESH_MS = 30_000;

const ROLE_LABELS = { tourist: 'Du khách', contributor: 'Tác giả', admin: 'Quản trị' };

function errorMessage(err) {
  if (err?.offline) return 'Không thể kết nối, vui lòng thử lại';
  if (err?.status === 403) return 'Chỉ quản trị viên được xem trang này';
  return err?.message || 'Chưa tải được số liệu thiết bị';
}

function Stat({ label, value, hint, accent = false }) {
  return (
    <div className={`card admin-stat${accent ? ' admin-stat--accent' : ''}`} data-testid="admin-stat">
      <span className="muted small">{label}</span>
      <b className="admin-stat__value">{value ?? '–'}</b>
      {hint ? <span className="muted small">{hint}</span> : null}
    </div>
  );
}

export default function OnlineDevicesPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getOnlineDevices());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="page page--narrow">
        <AppHeader title="Thiết bị đang online" backTo="/account" />
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>Chỉ quản trị viên được xem trang này</div>
        </div>
      </div>
    );
  }

  const totals = data?.totals;
  const minutes = Math.round((data?.onlineWindowSeconds ?? 120) / 60);
  const hasPresence = totals?.onlineDevices != null;
  const onlineNow = hasPresence ? totals.onlineDevices : totals?.online;
  const guests = hasPresence ? totals.onlineGuests : null;
  const activeHint = `7 ngày: ${totals?.active7Days ?? '–'} · 30 ngày: ${totals?.active30Days ?? '–'}`;

  return (
    <div className="page admin-devices">
      <AppHeader title="Thiết bị đang online" backTo="/admin" />
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
      ) : (
        <>
          <div className="admin-stats admin-stats--3" aria-label="Tổng quan thiết bị">
            <Stat
              label="Đang online"
              value={onlineNow}
              hint={hasPresence ? `Hoạt động trong ${minutes} phút qua` : 'Chỉ thiết bị đã đăng nhập'}
              accent
            />
            <Stat label="Khách chưa đăng nhập" value={guests} hint="Đang online" />
            <Stat label="Tài khoản đang online" value={totals?.onlineAccounts} />
            <Stat label="Đang đăng nhập" value={totals?.signedIn} hint="Phiên còn hiệu lực" />
            <Stat label="Thiết bị truy cập hôm nay" value={totals?.activeToday} hint={activeHint} />
            <Stat label="Thiết bị đã đăng nhập" value={totals?.devicesSeen} hint="Trong 30 ngày" />
          </div>

          {hasPresence ? null : (
            <p className="muted small" role="status">
              Chưa đếm được khách chưa đăng nhập (máy chủ không phản hồi), số online chỉ gồm thiết bị đã đăng nhập.
            </p>
          )}

          <p className="muted small">
            Cập nhật lúc <time dateTime={data.at}>{formatDateTime(data.at)}</time> · tự làm mới mỗi 30 giây
          </p>

          {data.online.length === 0 ? (
            <p className="muted">
              {onlineNow ? 'Không có thiết bị đã đăng nhập nào online.' : 'Hiện không có thiết bị nào online.'}
            </p>
          ) : (
            <div className="admin-table__wrap">
              <table className="admin-table" aria-label="Thiết bị đã đăng nhập đang online">
                <thead>
                  <tr>
                    <th scope="col">Thiết bị</th>
                    <th scope="col">Tài khoản</th>
                    <th scope="col">Vị trí</th>
                    <th scope="col">Đăng nhập lúc</th>
                    <th scope="col">Hoạt động</th>
                  </tr>
                </thead>
                <tbody>
                  {data.online.map((d) => (
                    <tr key={d.id} data-testid="online-row">
                      <td>{d.deviceName || 'Thiết bị không rõ'}</td>
                      <td>
                        <b>{d.user?.fullName || '—'}</b>
                        <span className="muted small admin-table__sub">
                          {d.user?.email}
                          {d.user?.role ? ` · ${ROLE_LABELS[d.user.role] || d.user.role}` : ''}
                        </span>
                      </td>
                      <td>{d.location || 'Không xác định'}</td>
                      <td><time dateTime={d.createdAt}>{formatDateTime(d.createdAt)}</time></td>
                      <td className="device__active">{formatLastActive(d.lastActiveAt) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {guests ? (
            <p className="muted small" data-testid="guest-note">
              + {guests} khách chưa đăng nhập đang online (không có trong bảng vì không gắn với tài khoản)
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
