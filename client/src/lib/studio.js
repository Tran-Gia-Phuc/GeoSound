// =========================================================
// Lớp dữ liệu "Studio" của người đóng góp (contributor).
//   UC09 — CRUD tour của chính mình. Mọi thao tác cần JWT role=contributor
//   (auth:true → gắn Bearer + tự refresh). Qua gateway: /api/tours/mine/*.
// Các UC tiếp theo (UC10 điểm dừng, UC11 route, UC12 ngôn ngữ, UC13 xem thử)
// sẽ bổ sung hàm vào chính file này.
// =========================================================
import { api } from './api.js';

// Nhãn + sắc thái hiển thị cho vòng đời tour (khớp TOUR_STATUS ở backend).
export const TOUR_STATUS_META = {
  draft: { label: 'Nháp', tone: 'neutral' },
  ai_checking: { label: 'Đang kiểm duyệt AI', tone: 'info' },
  ai_warning: { label: 'Cảnh báo AI', tone: 'warn' },
  pending_review: { label: 'Chờ duyệt', tone: 'info' },
  public: { label: 'Công khai', tone: 'live' },
  rejected: { label: 'Bị từ chối', tone: 'danger' },
  restricted: { label: 'Truy cập hạn chế', tone: 'warn' },
  hidden: { label: 'Đang ẩn', tone: 'muted' },
};
export const statusMeta = (status) =>
  TOUR_STATUS_META[status] || { label: status || 'Không rõ', tone: 'neutral' };

// ---- UC09: tour của tôi ----
export async function listMyTours() {
  const b = await api.get('/api/tours/mine', { auth: true });
  return b.tours;
}
export async function createTour(data) {
  const b = await api.post('/api/tours', data, { auth: true });
  return b.tour;
}
export async function getMyTour(id) {
  const b = await api.get(`/api/tours/mine/${encodeURIComponent(id)}`, { auth: true });
  return b.tour;
}
/** Trả { message, tour, requiresResubmit } — sửa tour đang công khai sẽ về Nháp. */
export async function updateTour(id, patch) {
  return api.patch(`/api/tours/mine/${encodeURIComponent(id)}`, patch, { auth: true });
}
export async function deleteTour(id) {
  return api.del(`/api/tours/mine/${encodeURIComponent(id)}`, { auth: true });
}

// ---- UC10: điểm dừng của tour ----
// Nhãn loại địa điểm (khớp PLACE_TYPES ở backend).
export const PLACE_TYPE_OPTIONS = [
  { value: 'landmark', label: 'Địa danh' },
  { value: 'museum', label: 'Bảo tàng' },
  { value: 'historical', label: 'Di tích lịch sử' },
  { value: 'nature', label: 'Thiên nhiên' },
  { value: 'food', label: 'Ẩm thực' },
  { value: 'shopping', label: 'Mua sắm' },
  { value: 'entertainment', label: 'Giải trí' },
  { value: 'other', label: 'Khác' },
];
export const PLACE_TYPE_LABELS = Object.fromEntries(PLACE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const placesBase = (tourId) => `/api/tours/mine/${encodeURIComponent(tourId)}/places`;

export async function listPlaces(tourId) {
  const b = await api.get(placesBase(tourId), { auth: true });
  return b.places;
}
export async function addPlace(tourId, data) {
  const b = await api.post(placesBase(tourId), data, { auth: true });
  return b.place;
}
export async function updatePlace(tourId, placeId, patch) {
  const b = await api.patch(`${placesBase(tourId)}/${encodeURIComponent(placeId)}`, patch, { auth: true });
  return b.place;
}
export async function deletePlace(tourId, placeId) {
  return api.del(`${placesBase(tourId)}/${encodeURIComponent(placeId)}`, { auth: true });
}
export async function reorderPlaces(tourId, order) {
  const b = await api.patch(`${placesBase(tourId)}/reorder`, { order }, { auth: true });
  return b.places;
}

// ---- UC11: cấu hình route & vùng kích hoạt ----
export async function getRouteConfig(tourId) {
  const b = await api.get(`/api/tours/mine/${encodeURIComponent(tourId)}/route-config`, { auth: true });
  return b.config;
}
export async function saveRouteConfig(tourId, config) {
  const b = await api.put(`/api/tours/mine/${encodeURIComponent(tourId)}/route-config`, config, { auth: true });
  return b.config;
}

// ---- UC12: đa ngôn ngữ & TTS ----
export const TTS_GENDER_OPTIONS = [
  { value: 'female', label: 'Giọng nữ' },
  { value: 'male', label: 'Giọng nam' },
];
// Nhãn nguồn bản dịch (textSource) để hiển thị cho tác giả.
export const TEXT_SOURCE_LABELS = {
  source: 'Ngôn ngữ gốc',
  machine: 'Dịch tự động',
  edited: 'Đã chỉnh tay',
};

export async function getLanguageConfig(tourId) {
  const b = await api.get(`/api/tours/mine/${encodeURIComponent(tourId)}/languages`, { auth: true });
  return b.config;
}
export async function setTourLanguages(tourId, { secondary, voice }) {
  const b = await api.put(`/api/tours/mine/${encodeURIComponent(tourId)}/languages`, { secondary, voice }, { auth: true });
  return b.config;
}
export async function previewTts(tourId, placeId, lang) {
  // { placeId, language, url, prerendered }
  return api.post(
    `/api/tours/mine/${encodeURIComponent(tourId)}/places/${encodeURIComponent(placeId)}/tts-preview`,
    { lang },
    { auth: true },
  );
}
export async function updateTranslation(tourId, placeId, lang, text) {
  const b = await api.patch(
    `/api/tours/mine/${encodeURIComponent(tourId)}/places/${encodeURIComponent(placeId)}/translations/${encodeURIComponent(lang)}`,
    { text },
    { auth: true },
  );
  return b.translation;
}

// ---- UC13: xem thử tour (tác giả) ----
// Trả view giống chi tiết tour công khai (buildTourDetailView) để tái dùng trình
// phát UC04; chạy với MỌI trạng thái. E1 (thiếu điểm/route) → API ném lỗi 422.
// Chữ ký (lang, opts) để khớp prop loadDetail của TourPlayerPage.
export async function previewTour(tourId, lang, opts) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const b = await api.get(`/api/tours/mine/${encodeURIComponent(tourId)}/preview${q}`, { ...opts, auth: true });
  return b.tour;
}
