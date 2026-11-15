// =========================================================
// SessionWatcher (UC23): root layout route. When the server ends this device's
// session (refresh answered 401, e.g. signed out from another device), the
// tokens are already cleared; send the user to /login with a short notice.
// It also keeps this browser "online" for the admin view (#265, #329).
// =========================================================
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { onSessionEnded } from '../lib/token-store.js';
import { HEARTBEAT_MS, beatPresence, leavePresence, isMediaPlaying } from '../lib/presence.js';

export const SESSION_ENDED_NOTICE = 'Phiên đăng nhập đã kết thúc trên thiết bị này';

// #329 — every visitor, signed in or not, tells Auth this browser is in use, so the admin view
// counts it as online (devices seen in the last 2 minutes): a beat at once, then every minute while
// the tab is visible or audio is playing (a tour heard with the screen locked), again when the tab
// comes back, and a leave beacon when the page is closed. Signed in, the beat also touches the session.
function usePresence() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    beatPresence(); // throttled: the StrictMode re-mount in dev sends no second beat
    const tick = () => {
      if (document.visibilityState === 'visible' || isMediaPlaying()) beatPresence();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') beatPresence();
    };
    const onPageShow = (e) => {
      if (e.persisted) beatPresence({ force: true }); // back from the back/forward cache
    };
    const timer = setInterval(tick, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', leavePresence);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', leavePresence);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}

export default function SessionWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  usePresence();

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
