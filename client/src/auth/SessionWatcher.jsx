// =========================================================
// SessionWatcher (UC23): root layout route. When the server ends this device's
// session (refresh answered 401, e.g. signed out from another device), the
// tokens are already cleared; send the user to /login with a short notice.
// =========================================================
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { onSessionEnded } from '../lib/token-store.js';

export const SESSION_ENDED_NOTICE = 'Phiên đăng nhập đã kết thúc trên thiết bị này';

export default function SessionWatcher() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(
    () =>
      onSessionEnded(() => {
        if (location.pathname === '/login') return;
        const next = encodeURIComponent(location.pathname + location.search);
        navigate(`/login?next=${next}`, { replace: true, state: { sessionEnded: true } });
      }),
    [navigate, location.pathname, location.search],
  );

  return <Outlet />;
}
