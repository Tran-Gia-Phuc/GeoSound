// Tiện ích định dạng hiển thị (UC04).

/** Giây -> "m:ss". NaN/∞ -> "--:--". */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Mét -> chuỗi gọn tiếng Việt ("120 m" / "1,4 km"). */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

const LANG_LABELS = {
  vi: 'Tiếng Việt',
  en: 'English',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  es: 'Español',
  de: 'Deutsch',
  th: 'ไทย',
  ru: 'Русский',
};

/** Mã ngôn ngữ -> tên bản ngữ (fallback: viết hoa mã). */
export function langLabel(code) {
  return LANG_LABELS[code] || (code ? code.toUpperCase() : '');
}
