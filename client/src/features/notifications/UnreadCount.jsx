// =========================================================
// Unread notification count (UC16), shared by the app shell badge, the account
// menu and the notification centre.
//   - Only when signed in; a guest always has 0 and makes no request.
//   - Loaded on mount, when the page gets focus or becomes visible again, and
//     every 60 s while the page is visible (the timer stops while hidden).
//   - A failed request keeps the last known count (the badge is best effort).
// =========================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getUnreadCount } from '../../lib/notifications.js';

export const UNREAD_POLL_MS = 60_000;

const UnreadContext = createContext({ unread: 0, refresh: () => {}, setUnread: () => {} });

/** @returns {{ unread: number, refresh: () => void, setUnread: (n: number) => void }} */
export function useUnreadCount() {
  return useContext(UnreadContext);
}

/** "99+" above 99. */
export const badgeText = (n) => (n > 99 ? '99+' : String(n));

export function UnreadCountProvider({ children }) {
  const { authenticated, user } = useAuth();
  const userId = authenticated ? user?.id ?? 'me' : null;
  const [unread, setUnreadState] = useState(0);
  const seq = useRef(0);

  // Any local change (mark read) wins over a request already in flight.
  const setUnread = useCallback((n) => {
    seq.current += 1;
    setUnreadState(Math.max(0, Number(n) || 0));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current;
    try {
      const n = await getUnreadCount();
      if (mine === seq.current) setUnreadState(n);
    } catch {
      /* keep the last known count */
    }
  }, [userId]);

  useEffect(() => {
    seq.current += 1;
    setUnreadState(0);
    if (!userId) return undefined;

    let timer = null;
    const visible = () => document.visibilityState !== 'hidden';
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      if (visible()) timer = setInterval(refresh, UNREAD_POLL_MS);
    };
    const onVisibility = () => {
      if (visible()) {
        refresh();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => {
      if (visible()) refresh();
    };

    refresh();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ unread: userId ? unread : 0, refresh, setUnread }), [userId, unread, refresh, setUnread]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

/** Layout route: the screens with the app shell share one unread count (and one poll). */
export function UnreadCountLayout() {
  return (
    <UnreadCountProvider>
      <Outlet />
    </UnreadCountProvider>
  );
}
