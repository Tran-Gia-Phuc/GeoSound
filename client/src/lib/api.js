// =========================================================
// Lớp gọi API tới gateway.
//   - UC04 tiêu thụ UC02/UC11/UC12 (GET tour, không cần đăng nhập).
//   - UC07/UC08 cần JWT: request() tự gắn Authorization: Bearer <access>,
//     và tự làm mới access token khi gặp 401 (refresh 1 lần rồi thử lại).
// Dev: Vite proxy '/api' -> gateway:8080 (vite.config.js).
// =========================================================
import { readAuth, writeAuth, clearAuth, endSession, getAccessToken, getRefreshToken } from './token-store.js';
import { getDeviceId } from './device-id.js';
import { localizeUrl, localizeUrls } from './media-url.js';

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
  // #263: media URLs on http://localhost:8080/api/... -> same origin, so phones can load them.
  return localizeUrls(body, BASE);
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

// UC23: Auth rotates the refresh token and treats a second use of the old one as theft (the
// session is signed out). Tabs share localStorage, so refreshes are serialised across tabs with
// a Web Lock, and a tab that waited reuses the tokens another tab already rotated.
async function refreshTokens() {
  const seen = getRefreshToken();
  if (!seen) return null;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks?.request
    ? locks.request('geosound-auth-refresh', () => rotateTokens(seen))
    : rotateTokens(seen);
}

async function rotateTokens(seen) {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  if (refreshToken !== seen) return getAccessToken(); // another tab already rotated
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken, deviceId: getDeviceId() }),
    });
    if (!res.ok) {
      // 401 (e.g. code session_revoked): this device was signed out on the server.
      if (res.status === 401) endSession();
      else clearAuth();
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
 * Gửi request và trả về Response thô (chưa đọc body). `auth:true` gắn access token;
 * `refresh:true` (mặc định) tự refresh 1 lần khi 401 rồi gọi lại.
 * body là Blob/File → gửi nguyên nội dung với Content-Type của file (tải ảnh/audio).
 * Mất mạng → ApiError { offline: true }; AbortError giữ nguyên.
 */
async function send(method, path, { body, auth = false, signal, accept = 'application/json', refresh = true } = {}) {
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  const doFetch = async (token) => {
    const headers = { Accept: accept };
    if (raw) headers['Content-Type'] = body.type || 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(`${BASE}${path}`, {
        method,
        headers,
        signal,
        body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw e; // caller huỷ chủ động — để nguyên cho .catch bỏ qua
      throw new ApiError('Không kết nối được máy chủ', { offline: true });
    }
  };

  let res = await doFetch(auth ? getAccessToken() : null);
  if (res.status !== 401 || !auth || !refresh) return res;

  // 401 trên request cần đăng nhập → thử refresh rồi gọi lại một lần.
  if (!refreshing) refreshing = refreshTokens().finally(() => (refreshing = null));
  const newToken = await refreshing;
  if (newToken) res = await doFetch(newToken);
  return res;
}

/**
 * Gọi API chung. `auth:true` gắn access token; tự refresh 1 lần khi 401.
 * @param {string} method @param {string} path
 * @param {{ body?: any, auth?: boolean, signal?: AbortSignal }} [opts]
 */
export async function request(method, path, { body, auth = false, signal } = {}) {
  const res = await send(method, path, { body, auth, signal });
  const parsed = await parse(res);
  if (!res.ok) throw fail(res, parsed);
  return parsed;
}

/**
 * Chatbot: request trả về Response thô để caller tự đọc luồng (Server-Sent Events) và
 * tự đọc body lỗi. Gắn access token khi đã đăng nhập nhưng KHÔNG refresh khi 401
 * (gateway không kiểm JWT cho chat; 401 ở đây là lỗi cấu hình). Không đổi URL media.
 * @param {string} method @param {string} path
 * @param {{ body?: any, signal?: AbortSignal, accept?: string }} [opts]
 */
export function stream(method, path, { body, signal, accept = 'text/event-stream' } = {}) {
  return send(method, path, { body, signal, accept, auth: !!getAccessToken(), refresh: false });
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  stream,
};

/**
 * UC03 offline download: raw request for one media file (image / audio) of a tour package.
 * Returns the Response; the caller reads the bytes as a Blob. Local gateway URLs are rewritten
 * like every other response (#263). Network failure -> ApiError { offline: true }.
 * @param {string} url @param {{ method?: 'GET'|'HEAD', signal?: AbortSignal }} [opts]
 */
export async function fetchAsset(url, { method = 'GET', signal } = {}) {
  try {
    return await fetch(localizeUrl(url, BASE), { method, signal, cache: 'no-store' });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('Không kết nối được máy chủ', { offline: true });
  }
}

/**
 * Chi tiết tour công khai + route + ngôn ngữ/TTS (UC02 detail, dùng cho UC04).
 * GET /api/tours/:id?lang=xx -> { tour: <buildTourDetailView> }
 */
export async function fetchTourDetail(id, lang, opts) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const body = await request('GET', `/api/tours/${encodeURIComponent(id)}${q}`, opts);
  return body.tour;
}
