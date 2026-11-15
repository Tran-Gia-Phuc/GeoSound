// Giao diện sáng/tối, nhớ lựa chọn (mặc định theo hệ thống).
// Chỉ đổi ở màn Tài khoản; applyStoredTheme() chạy lúc khởi động để mọi màn
// đều đúng giao diện ngay từ đầu.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'geosound:theme';
export const THEME_OPTIONS = [
  { value: 'system', label: 'Tự động' },
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
];

function stored() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Gọi một lần lúc khởi động app (main.jsx). */
export function applyStoredTheme() {
  apply(stored());
}

export function useTheme() {
  const [theme, setThemeState] = useState(stored); // 'system' | 'light' | 'dark'

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* no-op */
    }
  }, [theme]);

  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);

  const setTheme = useCallback((t) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState(isDark ? 'light' : 'dark'), [isDark]);

  return { theme, setTheme, isDark, toggle };
}
