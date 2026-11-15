// =========================================================
// Tải ảnh/audio của tour lên media service (UC09 ảnh bìa, UC10 ảnh + audio điểm).
//   POST /api/media/uploads?kind=image|audio  (body = file) → { url, … }
// Kiểm trước ở client để báo lỗi ngay (máy chủ vẫn kiểm lại nội dung file).
// =========================================================
import { api } from './api.js';

const MB = 1024 * 1024;

export const MEDIA_RULES = {
  image: {
    accept: 'image/jpeg,image/png,image/webp,image/gif',
    types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 8 * MB,
    label: 'JPG, PNG, WebP hoặc GIF, tối đa 8 MB',
  },
  audio: {
    accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,.m4a,.mp3',
    types: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'],
    maxBytes: 25 * MB,
    label: 'MP3, M4A, WAV hoặc OGG, tối đa 25 MB',
  },
};

// Một số trình duyệt để trống / đặt sai type cho .m4a → suy theo đuôi file.
const BY_EXT = { m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac' };

function normalize(file) {
  if (file.type && file.type !== 'application/octet-stream') return file;
  const ext = file.name?.split('.').pop()?.toLowerCase();
  const type = BY_EXT[ext];
  return type ? new File([file], file.name, { type }) : file;
}

/** Kiểm nhanh ở client. Trả chuỗi lỗi hoặc null. */
export function checkFile(file, kind) {
  const rule = MEDIA_RULES[kind];
  const f = normalize(file);
  // Bản ghi âm trình duyệt có tham số (vd "audio/webm;codecs=opus") → so phần loại.
  if (!rule.types.includes(f.type.split(';')[0].trim())) return `Định dạng không hỗ trợ — chọn ${rule.label}.`;
  if (f.size > rule.maxBytes) return `File quá lớn — ${rule.label}.`;
  return null;
}

/** @returns {Promise<{ url: string, kind: string, contentType: string, size: number }>} */
export async function uploadMedia(file, kind) {
  return api.post(`/api/media/uploads?kind=${kind}`, normalize(file), { auth: true });
}
