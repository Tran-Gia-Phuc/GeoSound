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
