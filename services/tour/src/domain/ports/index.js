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

/**
 * @typedef {Object} PlaceRepository
 * @property {(place: import('../entities/place.js').Place) => Promise<import('../entities/place.js').Place>} create
 * @property {(id: string) => Promise<import('../entities/place.js').Place|null>} findById
 * @property {(tourId: string) => Promise<import('../entities/place.js').Place[]>} listByTour  // theo sequence tăng dần
 * @property {(place: import('../entities/place.js').Place) => Promise<import('../entities/place.js').Place>} save
 * @property {(id: string) => Promise<void>} delete
 * @property {(tourId: string) => Promise<number>} nextSequence  // sequence kế tiếp để thêm cuối
 * @property {(tourId: string, orderedIds: string[]) => Promise<void>} reorder  // đặt lại thứ tự
 */

/**
 * Kiểm tra vị trí có nằm trong vùng cấm không (E2 — UC10).
 * @typedef {Object} ForbiddenZoneChecker
 * @property {(coords: { lat: number, lng: number }) => Promise<void>} assertAllowed  // ném ForbiddenZoneError nếu trong vùng cấm
 */

/**
 * Nguồn dữ liệu vùng cấm cho ForbiddenZoneChecker.
 * geometry = GeoJSON Polygon: { type:'Polygon', coordinates:[[[lng,lat],...]] }.
 * @typedef {Object} ForbiddenZoneRepository
 * @property {() => Promise<Array<{ id: string, name: string, type: string, geometry: object }>>} listActive
 */

export {};
