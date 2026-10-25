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

/** Số phút -> chuỗi gọn tiếng Việt ("25 phút" / "1 giờ 10 phút"). */
export function formatMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return '0 phút';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
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
