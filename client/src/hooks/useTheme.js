// Chuyển sáng/tối, nhớ lựa chọn (mặc định theo hệ thống).
import { useCallback, useEffect, useState } from 'react';

const KEY = 'geosound:theme';

function initial() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(initial); // 'system' | 'light' | 'dark'

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* no-op */
    }
  }, [theme]);

  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);

  const toggle = useCallback(() => setTheme((t) => (isDark ? 'light' : 'dark')), [isDark]);

  return { theme, isDark, toggle };
}
