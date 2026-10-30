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

// API trả mã giọng (VOICE_LABEL ở tour service): 'human' | 'tts'.
const VOICE_LABELS = {
  human: 'Giọng người thật',
  tts: 'Giọng đọc máy',
};

/** Mã giọng -> nhãn hiển thị. Chuỗi lạ giữ nguyên, rỗng -> ''. */
export function voiceLabel(code) {
  return VOICE_LABELS[code] || code || '';
}

/** Điểm có giọng người thật không (để tô chip khác màu). */
export const isHumanVoice = (code) => code === 'human';

/**
 * Số thứ tự hiển thị của các điểm: 1, 2, 3… theo `sequence` (0-based ở API).
 * @param {Array<{id:string, sequence?:number}>} places
 * @returns {Map<string, number>} placeId -> số thứ tự (bắt đầu từ 1)
 */
export function stopNumbers(places = []) {
  const ordered = [...places].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return new Map(ordered.map((p, i) => [p.id, i + 1]));
}

/**
 * Relative last activity (UC23): "Đang hoạt động" under 2 minutes, then
 * "x phút trước", "x giờ trước", "x ngày trước". Invalid date -> ''.
 */
export function formatLastActive(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 2) return 'Đang hoạt động';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

/** ISO time -> "HH:mm dd/MM/yyyy" (vi-VN). Invalid date -> ''. */
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${time} ${d.toLocaleDateString('vi-VN')}`;
}
