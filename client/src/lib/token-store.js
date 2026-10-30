// =========================================================
// Kho token phía client (UC01). Giữ access/refresh token + hồ sơ người dùng
// trong localStorage để phiên sống qua lần tải lại. Tách riêng khỏi api.js và
// auth.js để tránh phụ thuộc vòng (api cần đọc token; auth ghi token).
// JWT access payload = { sub, email, role } — khớp shared/middleware verifyJwt.
// =========================================================
const KEY = 'geosound:auth';

const listeners = new Set();

/** @returns {{ accessToken: string, refreshToken: string, user: object }|null} */
export function readAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeAuth(auth) {
  try {
    if (auth) localStorage.setItem(KEY, JSON.stringify(auth));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage bị chặn (ẩn danh) — vẫn chạy trong RAM qua listeners */
  }
  for (const fn of listeners) fn(auth);
}

export function clearAuth() {
  writeAuth(null);
}

// UC23: the server ended this device's session (refresh answered 401).
const endedListeners = new Set();

/** Clears the tokens and tells listeners the session was ended by the server. */
export function endSession() {
  clearAuth();
  for (const fn of endedListeners) fn();
}

/** Subscribe to server-side session ends (SessionWatcher redirects to /login). */
export function onSessionEnded(fn) {
  endedListeners.add(fn);
  return () => endedListeners.delete(fn);
}

export function getAccessToken() {
  return readAuth()?.accessToken ?? null;
}

export function getRefreshToken() {
  return readAuth()?.refreshToken ?? null;
}

/** Đăng ký lắng nghe thay đổi phiên (AuthProvider dùng để re-render). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Giải mã payload JWT (không xác minh chữ ký — chỉ để đọc role/exp phía client). */
export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

/** Token đã hết hạn (so với exp, trừ 10s phòng lệch giờ). */
export function isExpired(token) {
  const p = decodeJwt(token);
  if (!p?.exp) return false;
  return Date.now() >= p.exp * 1000 - 10_000;
}
