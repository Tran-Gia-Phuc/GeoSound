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
 * // --- UC02 đọc công khai (chỉ status=public) ---
 * @property {(filters: object) => Promise<number>} countPublic
 * @property {(filters: object, page: { skip: number, take: number, sort: string }) => Promise<import('../entities/tour.js').Tour[]>} searchPublicPage
 * @property {(filters: object) => Promise<string[]>} listPublicIds
 * @property {(ids: string[]) => Promise<import('../entities/tour.js').Tour[]>} findManyByIds
 * @property {(id: string) => Promise<import('../entities/tour.js').Tour|null>} findPublicById
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
 * // --- UC02 ---
 * @property {(tourIds: string[]) => Promise<Map<string, { count: number, humanCount: number }>>} statsByTours
 * @property {(tourIds: string[]) => Promise<Map<string, { lat: number, lng: number }>>} anchorsByTours
 * // --- UC07 khám phá địa điểm lẻ (chỉ địa điểm thuộc tour công khai) ---
 * @property {(filters: object) => Promise<number>} countPublicPlaces
 * @property {(filters: object, page: { skip: number, take: number }) => Promise<Array<object>>} searchPublicPlaces
 */

/**
 * Lịch trình cá nhân (UC07) — aggregate gồm các điểm snapshot. Repo nạp/ghi CẢ
 * cụm (items đi kèm). save() đồng bộ items: thêm mới (id=null), xoá item không
 * còn, cập nhật thứ tự.
 * @typedef {Object} ItineraryRepository
 * @property {(it: import('../entities/itinerary.js').Itinerary) => Promise<import('../entities/itinerary.js').Itinerary>} create
 * @property {(id: string) => Promise<import('../entities/itinerary.js').Itinerary|null>} findById
 * @property {(token: string) => Promise<import('../entities/itinerary.js').Itinerary|null>} findByShareToken
 * @property {(ownerId: string) => Promise<import('../entities/itinerary.js').Itinerary[]>} listByOwner
 * @property {(it: import('../entities/itinerary.js').Itinerary) => Promise<import('../entities/itinerary.js').Itinerary>} save
 * @property {(id: string) => Promise<void>} delete
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

/**
 * Cấu hình route & kích hoạt của một tour (UC11) — lưu/đọc cả cụm.
 * @typedef {Object} RouteConfigRepository
 * @property {(tourId: string) => Promise<import('../entities/route-config.js').RouteConfig|null>} findByTour
 * @property {(config: import('../entities/route-config.js').RouteConfig) => Promise<import('../entities/route-config.js').RouteConfig>} upsert
 */

/**
 * Dịch text sang ngôn ngữ khác (UC12). Lỗi → ném TranslationError (E1).
 * @typedef {Object} Translator
 * @property {(p: { text: string, from: string, to: string }) => Promise<string>} translate
 */

/**
 * Tổng hợp giọng đọc TTS (UC12). Lỗi → ném TtsError (E1).
 * @typedef {Object} TtsSynthesizer
 * @property {(p: { text: string, language: string, voice: { gender: string, region: string|null } }) => Promise<{ url: string, prerendered: boolean }>} synthesize
 */

/**
 * Ngôn ngữ của tour (UC12).
 * @typedef {Object} TourLanguageRepository
 * @property {(tourId: string) => Promise<import('../entities/tour-language.js').TourLanguage[]>} listByTour
 * @property {(tourId: string, langs: import('../entities/tour-language.js').TourLanguage[]) => Promise<void>} upsertMany
 * @property {(tourId: string, codes: string[]) => Promise<void>} deleteLanguages
 */

/**
 * Bản dịch + TTS của điểm theo ngôn ngữ (UC12).
 * @typedef {Object} PlaceTranslationRepository
 * @property {(tourId: string) => Promise<import('../entities/place-translation.js').PlaceTranslation[]>} listByTour
 * @property {(placeId: string, languageCode: string) => Promise<import('../entities/place-translation.js').PlaceTranslation|null>} findByPlaceLang
 * @property {(tx: import('../entities/place-translation.js').PlaceTranslation) => Promise<import('../entities/place-translation.js').PlaceTranslation>} upsert
 * @property {(tourId: string, codes: string[]) => Promise<void>} deleteByLanguages
 */

export {};
