// useCountdown — đếm ngược theo giây (hạn OTP, khoá nút "Gửi lại").
// restart(n) bắt đầu lại từ n giây; trả về số giây còn lại (0 = hết).
import { useCallback, useEffect, useState } from 'react';

export function useCountdown(initial = 0) {
  const [endsAt, setEndsAt] = useState(() => (initial > 0 ? Date.now() + initial * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);

  const restart = useCallback((seconds) => {
    setNow(Date.now());
    setEndsAt(seconds > 0 ? Date.now() + seconds * 1000 : 0);
  }, []);

  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  return [remaining, restart];
}

/** 102 -> "1:42" */
export const formatCountdown = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
