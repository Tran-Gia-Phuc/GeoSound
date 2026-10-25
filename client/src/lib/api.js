// =========================================================
// Lớp gọi API tới gateway (UC04 tiêu thụ UC02/UC11/UC12).
// Dev: Vite proxy '/api' -> gateway:8080 (vite.config.js).
// =========================================================
const BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(message, { status, code, offline } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.offline = !!offline;
  }
}

async function get(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    // Mất mạng / không tới được gateway (E4).
    throw new ApiError('Không kết nối được máy chủ', { offline: true });
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* body rỗng */
  }
  if (!res.ok) {
    throw new ApiError(body?.error || body?.message || `Lỗi ${res.status}`, {
      status: res.status,
      code: body?.code,
    });
  }
  return body;
}

/**
 * Chi tiết tour công khai + route + ngôn ngữ/TTS (UC02 detail, dùng cho UC04).
 * GET /api/tours/:id?lang=xx -> { tour: <buildTourDetailView> }
 */
export async function fetchTourDetail(id, lang, opts) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const body = await get(`/api/tours/${encodeURIComponent(id)}${q}`, opts);
  return body.tour;
}
