// =========================================================
// Ports (media) — hợp đồng tầng application cần, infrastructure hiện thực.
// =========================================================

/**
 * Lưu trữ file công khai (Supabase Storage / ổ đĩa local khi dev).
 * @typedef {Object} MediaStorage
 * @property {(p: { key: string, data: Buffer, contentType: string }) => Promise<{ url: string }>} put
 *   lưu file theo khoá, trả URL công khai tuyệt đối (http/https)
 */

export {};
