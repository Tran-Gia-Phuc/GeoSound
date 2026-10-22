// =========================================================
// Ports (hợp đồng mà application cần, infrastructure hiện thực).
// JS không có interface nên mô tả bằng JSDoc; container tiêm impl thật vào.
// Query không gian (PostGIS) của các UC sau nằm trong impl, KHÔNG rò ra domain.
// =========================================================

/**
 * @typedef {Object} TourRepository
 * @property {(tour: import('../entities/tour.js').Tour) => Promise<import('../entities/tour.js').Tour>} create
 * @property {(id: string) => Promise<import('../entities/tour.js').Tour|null>} findById
 * @property {(authorId: string) => Promise<import('../entities/tour.js').Tour[]>} listByAuthor
 * @property {(tour: import('../entities/tour.js').Tour) => Promise<import('../entities/tour.js').Tour>} save  // cập nhật nội dung/trạng thái
 * @property {(id: string) => Promise<void>} delete
 */

export {};
