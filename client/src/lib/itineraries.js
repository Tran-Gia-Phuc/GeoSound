// =========================================================
// API lịch trình cá nhân (UC07) + khám phá địa điểm (UC07 bước 1-2).
// Các thao tác của chủ sở hữu cần đăng nhập (auth:true → gắn Bearer + refresh).
// Xem/chia sẻ công khai (/shared, /places) không cần đăng nhập.
// =========================================================
import { api } from './api.js';

const langQ = (lang) => (lang ? `?lang=${encodeURIComponent(lang)}` : '');

// ---- Khám phá địa điểm lẻ (công khai) ----
export async function explorePlaces({ q, city, type, lat, lng, page = 1, pageSize = 20 } = {}) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (city) p.set('city', city);
  if (type) p.set('type', type);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    p.set('lat', String(lat));
    p.set('lng', String(lng));
  }
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  return api.get(`/api/places?${p.toString()}`);
}

// ---- Lịch trình của tôi ----
export async function listMyItineraries() {
  const b = await api.get('/api/itineraries', { auth: true });
  return b.itineraries;
}
export async function createItinerary(name) {
  const b = await api.post('/api/itineraries', { name }, { auth: true });
  return b.itinerary;
}
export async function getItinerary(id, lang) {
  const b = await api.get(`/api/itineraries/${encodeURIComponent(id)}${langQ(lang)}`, { auth: true });
  return b.itinerary;
}
export async function renameItinerary(id, name) {
  const b = await api.patch(`/api/itineraries/${encodeURIComponent(id)}`, { name }, { auth: true });
  return b.itinerary;
}
export async function deleteItinerary(id) {
  return api.del(`/api/itineraries/${encodeURIComponent(id)}`, { auth: true });
}
export async function addItem(id, placeId, lang) {
  const b = await api.post(`/api/itineraries/${encodeURIComponent(id)}/items${langQ(lang)}`, { placeId }, { auth: true });
  return b.itinerary;
}
export async function removeItem(id, itemId, lang) {
  const b = await api.del(`/api/itineraries/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}${langQ(lang)}`, { auth: true });
  return b.itinerary;
}
export async function reorderItems(id, orderedIds, lang) {
  const b = await api.patch(`/api/itineraries/${encodeURIComponent(id)}/items${langQ(lang)}`, { orderedIds }, { auth: true });
  return b.itinerary;
}
export async function shareItinerary(id, enabled = true) {
  return api.post(`/api/itineraries/${encodeURIComponent(id)}/share`, { enabled }, { auth: true });
}

// ---- Lịch trình chia sẻ (công khai, chỉ đọc) ----
export async function getSharedItinerary(token, lang) {
  const b = await api.get(`/api/itineraries/shared/${encodeURIComponent(token)}${langQ(lang)}`);
  return b.itinerary;
}
