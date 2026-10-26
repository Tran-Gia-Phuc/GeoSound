// Tìm địa chỉ → toạ độ (UC10 bước 3), qua proxy gateway /api/geocode (Nominatim).
import { api } from './api.js';

/** @returns {Promise<Array<{ name: string, displayName: string, lat: number, lng: number }>>} */
export async function searchAddress(q, opts) {
  const b = await api.get(`/api/geocode?q=${encodeURIComponent(q)}`, opts);
  return b.results || [];
}
