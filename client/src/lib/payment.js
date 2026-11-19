// =========================================================
// UC25 (#446) — buy a paid tour to download it offline (MoMo sandbox), over the gateway /api/tours.
//   Author: GET / PUT /api/tours/mine/:tourId/price -> { price, paidCount, revenue }
//   Buyer : POST /api/tours/:id/purchase -> { orderId, payUrl } (then the browser goes to MoMo)
//           GET  /api/tours/:id/purchase/mine -> { price, purchased, owner }
//   Return: GET  /api/tours/payments/:orderId -> { orderId, tourId, status, amount }
//   History: GET /api/tours/purchases/mine -> { items } (buyer, newest first, at most 50)
//            GET /api/tours/mine/:tourId/sales -> { items } (author, paid orders only)
// Listening online stays free; only the offline package of a paid tour needs a purchase.
// =========================================================
import { api } from './api.js';

export const PRICE_MIN = 1000;
export const PRICE_MAX = 50_000_000;

const pricePath = (tourId) => `/api/tours/mine/${encodeURIComponent(tourId)}/price`;

export const getTourPrice = (tourId, opts) => api.get(pricePath(tourId), { ...opts, auth: true });
export const setTourPrice = (tourId, price) => api.put(pricePath(tourId), { price }, { auth: true });

export const startPurchase = (tourId) => api.post(`/api/tours/${encodeURIComponent(tourId)}/purchase`, {}, { auth: true });
export const getMyPurchase = (tourId, opts) =>
  api.get(`/api/tours/${encodeURIComponent(tourId)}/purchase/mine`, { ...opts, auth: true });
export const getPaymentStatus = (orderId, opts) => api.get(`/api/tours/payments/${encodeURIComponent(orderId)}`, opts);
export const listMyPurchases = (opts) => api.get('/api/tours/purchases/mine', { ...opts, auth: true });
export const listTourSales = (tourId, opts) =>
  api.get(`/api/tours/mine/${encodeURIComponent(tourId)}/sales`, { ...opts, auth: true });

/** Same rules as the server: '' (free) or an integer 1 000..50 000 000. Returns an error text or ''. */
export function validatePrice(value) {
  if (!Number.isInteger(value) || (value !== 0 && (value < PRICE_MIN || value > PRICE_MAX))) {
    return `Giá phải là 0 (miễn phí) hoặc số nguyên từ ${formatVnd(PRICE_MIN)} đến ${formatVnd(PRICE_MAX)}`;
  }
  return '';
}

export const formatVnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
