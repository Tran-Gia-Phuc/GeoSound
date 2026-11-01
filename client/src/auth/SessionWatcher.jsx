// =========================================================
// SessionWatcher (UC23): root layout route. When the server ends this device's
// session (refresh answered 401, e.g. signed out from another device), the
// tokens are already cleared; send the user to /login with a short notice.
// =========================================================
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { onSessionEnded } from '../lib/token-store.js';
import { sendHeartbeat } from '../lib/sessions.js';
import { useAuth } from './AuthContext.jsx';

export const SESSION_ENDED_NOTICE = 'Phiên đăng nhập đã kết thúc trên thiết bị này';

// #265 — while signed in and the tab is visible, tell Auth this device is in use, so the admin
// view counts it as online (Auth keeps devices seen in the last 2 minutes as online). Sign-in and
// token refresh already mark activity, so the first beat waits one interval.
export const HEARTBEAT_MS = 60_000;

function useHeartbeat(enabled) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    let last = Date.now();
    const beat = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < HEARTBEAT_MS - 1000) return;
      last = Date.now();
      sendHeartbeat().catch(() => {}); // best effort: a missed beat only delays "online"
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [enabled]);
}

export default function SessionWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authenticated } = useAuth();
  useHeartbeat(authenticated);

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
