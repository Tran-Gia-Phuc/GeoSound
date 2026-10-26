// =========================================================
// Lớp gọi API tới gateway.
//   - UC04 tiêu thụ UC02/UC11/UC12 (GET tour, không cần đăng nhập).
//   - UC07/UC08 cần JWT: request() tự gắn Authorization: Bearer <access>,
//     và tự làm mới access token khi gặp 401 (refresh 1 lần rồi thử lại).
// Dev: Vite proxy '/api' -> gateway:8080 (vite.config.js).
// =========================================================
import { readAuth, writeAuth, clearAuth, getAccessToken, getRefreshToken } from './token-store.js';

const BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(message, { status, code, offline, details, missing, zone } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.offline = !!offline;
    this.details = details;
    this.missing = missing; // mục còn thiếu (vd xuất bản tour: [{ key, label }])
    this.zone = zone; // tên vùng cấm (lỗi đặt điểm trong vùng cấm)
  }
}

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* body rỗng */
  }
  return body;
}

function fail(res, body) {
  return new ApiError(body?.error || body?.message || `Lỗi ${res.status}`, {
    status: res.status,
    code: body?.code,
    details: body?.details,
    missing: body?.missing,
    zone: body?.zone,
  });
}

// Chỉ chạy MỘT lần refresh đồng thời — nhiều request 401 cùng lúc chờ chung.
let refreshing = null;

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const body = await parse(res);
    const current = readAuth();
    // /refresh trả { accessToken, refreshToken, expiresIn } (không kèm user).
    const next = {
      ...current,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? refreshToken,
    };
    writeAuth(next);
    return next.accessToken;
  } catch {
    return null; // mất mạng — giữ phiên, để lần sau thử lại
  }
}

/**
 * Gọi API chung. `auth:true` gắn access token; tự refresh 1 lần khi 401.
 * @param {string} method @param {string} path
 * @param {{ body?: any, auth?: boolean, signal?: AbortSignal }} [opts]
 * body là Blob/File → gửi nguyên nội dung với Content-Type của file (tải ảnh/audio).
 */
export async function request(method, path, { body, auth = false, signal } = {}) {
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  const doFetch = (token) => {
    const headers = { Accept: 'application/json' };
    if (raw) headers['Content-Type'] = body.type || 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res;
  try {
    res = await doFetch(auth ? getAccessToken() : null);
  } catch (e) {
    if (e?.name === 'AbortError') throw e; // caller huỷ chủ động — để nguyên cho .catch bỏ qua
    throw new ApiError('Không kết nối được máy chủ', { offline: true });
  }

  // 401 trên request cần đăng nhập → thử refresh rồi gọi lại một lần.
  if (res.status === 401 && auth && !refreshing) {
    refreshing = refreshTokens().finally(() => (refreshing = null));
  }
  if (res.status === 401 && auth) {
    const newToken = await (refreshing ?? Promise.resolve(null));
    if (newToken) {
      try {
        res = await doFetch(newToken);
      } catch (e) {
        if (e?.name === 'AbortError') throw e; // caller huỷ chủ động
        throw new ApiError('Không kết nối được máy chủ', { offline: true });
      }
    }
  }

  const parsed = await parse(res);
  if (!res.ok) throw fail(res, parsed);
  return parsed;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
};

/**
 * Chi tiết tour công khai + route + ngôn ngữ/TTS (UC02 detail, dùng cho UC04).
 * GET /api/tours/:id?lang=xx -> { tour: <buildTourDetailView> }
 */
export async function fetchTourDetail(id, lang, opts) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const body = await request('GET', `/api/tours/${encodeURIComponent(id)}${q}`, opts);
  return body.tour;
}
