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

// Language names come from the browser (Intl.DisplayNames), in the language itself ('de' -> 'Deutsch'),
// so a code added to SUPPORTED_LANGUAGES on the Tour service (#425) needs no client change.
const nameCache = new Map();

/** Mã ngôn ngữ -> tên bản ngữ ('fr' -> 'Français', 'zh-tw' -> '中文（台灣）'); fallback: viết hoa mã. */
export function langLabel(code) {
  if (!code) return '';
  const key = String(code);
  if (!nameCache.has(key)) nameCache.set(key, nativeName(key));
  return nameCache.get(key);
}

function nativeName(code) {
  try {
    const tag = Intl.getCanonicalLocales(code)[0];
    const name = new Intl.DisplayNames([tag], { type: 'language', fallback: 'none' }).of(tag);
    if (name) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    /* invalid code or no Intl.DisplayNames */
  }
  return code.toUpperCase();
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

/**
 * Relative time of a notification (UC16): "Vừa xong", "x phút trước", "x giờ trước",
 * "x ngày trước" (under a week), then the date. Invalid date -> ''.
 */
export function formatRelative(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(t).toLocaleDateString('vi-VN');
}

/** Bytes -> "512 B" / "3,2 KB" / "4,8 MB" / "1,2 GB" (vi-VN decimal comma). Invalid -> ''. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}
