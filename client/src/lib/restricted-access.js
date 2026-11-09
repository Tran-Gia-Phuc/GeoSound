// =========================================================
// Restricted access with a passcode (UC14) over the gateway /api/tours.
//   Owner : GET / PUT / DELETE /api/tours/mine/:tourId/access
//   Tester: POST /api/tours/:id/unlock, GET /api/tours/:id/access/mine,
//           GET /api/tours/:id/restricted?lang= (same view as the public detail)
// The passcode is never returned by the server.
// =========================================================
import { api } from './api.js';

export const PASSCODE_MIN = 6;
export const PASSCODE_MAX = 32;

/** Same rules as the server (R3): trimmed, 6 to 32 characters, no whitespace. '' when valid. */
export function validatePasscode(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return 'Vui lòng nhập mã truy cập';
  if (/\s/.test(value)) return 'Mã truy cập không được chứa khoảng trắng';
  if (value.length < PASSCODE_MIN || value.length > PASSCODE_MAX) {
    return `Mã truy cập phải từ ${PASSCODE_MIN} đến ${PASSCODE_MAX} ký tự`;
  }
  return '';
}

const ownerPath = (tourId) => `/api/tours/mine/${encodeURIComponent(tourId)}/access`;

/** Owner: { restricted, passcodeSetAt, testers } */
export function getTourAccess(tourId, opts) {
  return api.get(ownerPath(tourId), { ...opts, auth: true });
}

/** Owner: turn on or change -> { restricted: true, passcodeSetAt, testers, changed: 'enabled' | 'passcode' } */
export function setTourPasscode(tourId, passcode) {
  return api.put(ownerPath(tourId), { passcode: String(passcode).trim() }, { auth: true });
}

/** Owner: turn off -> the tour (status draft). */
export async function disableTourAccess(tourId) {
  const body = await api.del(ownerPath(tourId), { auth: true });
  return body?.tour;
}

/** Tester: 403 wrong_passcode, 404 not restricted, 429 too_many_attempts. */
export function unlockTour(tourId, passcode) {
  return api.post(`/api/tours/${encodeURIComponent(tourId)}/unlock`, { passcode: String(passcode).trim() }, { auth: true });
}

/** Tester: true when this account may open the tour (the owner always may); 404 when not restricted. */
export async function getMyTourAccess(tourId, opts) {
  const body = await api.get(`/api/tours/${encodeURIComponent(tourId)}/access/mine`, { ...opts, auth: true });
  return !!body?.unlocked;
}

/** Owner or unlocked tester: the tour detail view (player shape) plus restricted: true. */
export async function fetchRestrictedTour(tourId, lang, opts) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const body = await api.get(`/api/tours/${encodeURIComponent(tourId)}/restricted${q}`, { ...opts, auth: true });
  return body?.tour;
}

/** UC12 — automatic translation of a restricted tour (unlocked tester or owner). */
export async function translateRestrictedTour(tourId, lang) {
  const body = await api.post(
    `/api/tours/${encodeURIComponent(tourId)}/restricted/translations/${encodeURIComponent(lang)}`,
    undefined,
    { auth: true },
  );
  return body?.tour;
}

/** Link the owner shares with testers. */
export const unlockPath = (tourId) => `/tour/${encodeURIComponent(tourId)}/unlock`;
export const restrictedPath = (tourId) => `/tour/${encodeURIComponent(tourId)}/restricted`;
