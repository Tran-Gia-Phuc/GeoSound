// =========================================================
// Lớp dữ liệu UC02 — Tìm & xem tour công khai (không cần đăng nhập).
//   searchTours() -> GET /api/tours?q&city&language&type&sort&lat&lng&page&limit
//   (chi tiết tour dùng fetchTourDetail() ở lib/api.js — tái dùng cho UC04)
// =========================================================
import { api } from './api.js';
import { requireDiscoveryPage } from './discovery-data.js';

// Loại tour (khớp TOUR_TYPES ở backend: walking/driving/cycling/indoor).
export const TOUR_TYPE_OPTIONS = [
  { value: 'walking', label: 'Đi bộ' },
  { value: 'driving', label: 'Lái xe' },
  { value: 'cycling', label: 'Đạp xe' },
  { value: 'indoor', label: 'Trong nhà' },
];
export const TOUR_TYPE_LABELS = Object.fromEntries(TOUR_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Ngôn ngữ hỗ trợ (khớp nhãn ở lib/format.js và danh sách của Tour / AI service).
export const LANGUAGE_OPTIONS = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'th', label: 'ไทย' },
  { value: 'ru', label: 'Русский' },
];

// Tiêu chí sắp xếp (A1). "nearby" cần toạ độ người dùng.
export const SORT_OPTIONS = [
  { value: 'popular', label: 'Phổ biến' },
  { value: 'rating', label: 'Đánh giá cao' },
  { value: 'recent', label: 'Mới nhất' },
  { value: 'nearby', label: 'Gần tôi' },
];

/**
 * Tìm tour công khai. Bỏ qua tham số rỗng/undefined.
 * @param {{ q?, city?, language?, type?, sort?, lat?, lng?, page?, limit? }} [params]
 * @returns {Promise<{ tours: any[], total: number, page: number, limit: number, sort: string }>}
 */
export async function searchTours(params = {}, opts) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return requireDiscoveryPage(await api.get(`/api/tours${s ? `?${s}` : ''}`, opts), 'tours');
}

/**
 * UC04 / UC12 — ask for an automatic translation of a public tour into `lang`.
 * POST /api/tours/:id/translations/:lang -> { tour } (detail in that language).
 * Errors: 400 unsupported, 403 auto_translate_disabled, 429 rate_limited, 503 translation_unavailable.
 */
export async function translateTour(tourId, lang) {
  const body = await api.post(`/api/tours/${encodeURIComponent(tourId)}/translations/${encodeURIComponent(lang)}`);
  return body?.tour;
}
