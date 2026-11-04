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
 * // --- UC15 AI moderation: writes only status + moderationReasons/moderationRevision ---
 * @property {(id: string, fields: { status?, moderationReasons?, moderationRevision? }) => Promise<import('../entities/tour.js').Tour>} updateModeration
 * @property {(id: string, revision: string, fields: { status, moderationReasons }) => Promise<number>} applyModerationResultIf  // only while ai_checking + same revision; returns rows updated
 * // --- UC19 admin review ---
 * @property {(statuses: string[]) => Promise<import('../entities/tour.js').Tour[]>} listByStatuses  // updatedAt ascending
 * @property {(id: string, fromStatuses: string[], fields: { status, reviewReason }, log: { adminId, action, reason, fromStatus }) => Promise<number>} applyReviewDecisionIf  // only while status IN fromStatuses; writes the log row in the same transaction; returns rows updated
 */

/**
 * UC05 (#267) — ratings (table tour_ratings). Every write locks the caller's row and moves
 * tours.average_rating / rating_count in the same transaction (design R7).
 * @typedef {Object} TourRatingRepository
 * @property {(tourId: string, userId: string) => Promise<import('../entities/tour-rating.js').TourRating|null>} findByTourAndUser
 * @property {(fields: { tourId, userId, userName, stars, comment }) => Promise<{ created: boolean, rating, summary: { averageRating: number, ratingCount: number } }|null>} saveForUser  // create or edit; null only when a concurrent first submit of the same account won (retry once)
 * @property {(tourId: string, userId: string) => Promise<{ summary }|null>} deleteForUser  // null when the account has no rating
 * @property {(tourId: string, page: { skip: number, take: number }) => Promise<{ items: import('../entities/tour-rating.js').TourRating[], total: number }>} listByTour  // newest first
 * @property {(tourId: string) => Promise<Record<1|2|3|4|5, number>>} distribution
 */

/**
 * UC06 (#268) — community reports (table tour_reports). `createReport` runs one transaction: lock the
 * tour row, insert the report, count distinct open reporters since `windowStart`, then raise
 * tours.open_report_count and set tours.report_flagged_at (only when null and the threshold is
 * reached) without touching tours.updated_at.
 * @typedef {Object} TourReportRepository
 * @property {(tourId: string, reporterId: string) => Promise<import('../entities/tour-report.js').TourReport|null>} findByTourAndReporter
 * @property {(fields: { tourId, reporterId, reason, note }, rule: { windowStart: Date, threshold: number }) => Promise<{ report, openReportCount: number, recentReporters: number, flagged: boolean, flaggedNow: boolean }|null>} createReport  // null when the account already reported the tour (unique tour + reporter)
 */

/**
 * UC06 (#268) — tour.reported for the admin side (UC20). Never carries the reporter id.
 * Impl: infrastructure/messaging/event-tour-report-publisher.js. Null when the broker is not loaded.
 * @typedef {Object} TourReportEvents
 * @property {(tour, info: { count: number, reason: string, flagged: boolean }) => Promise<object>} reported
 */

/**
 * UC19 — admin decision log (read side; rows are written by TourRepository.applyReviewDecisionIf).
 * @typedef {Object} TourReviewActionRepository
 * @property {(tourId: string) => Promise<import('../entities/tour-review-action.js').TourReviewAction[]>} listByTour  // newest first
 */

/**
 * UC19 — notifies the contributor of an admin decision (tour.approved / tour.rejected /
 * tour.changes_requested). Impl: infrastructure/messaging/event-tour-review-publisher.js.
 * Null when the broker is not loaded (both event flags off).
 * @typedef {Object} TourReviewEvents
 * @property {(tour, adminId: string) => Promise<object>} approved
 * @property {(tour, reason: string) => Promise<object>} rejected
 * @property {(tour, reason: string) => Promise<object>} changesRequested
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
 * // --- UC15 AI moderation: writes only the moderation* columns ---
 * @property {(id: string, fields: { moderationStatus?, moderationReasons?, moderationRevision? }) => Promise<import('../entities/place.js').Place>} updateModeration
 * @property {(id: string, revision: string, fields: { moderationStatus, moderationReasons }) => Promise<number>} applyModerationResultIf  // only when the revision matches; returns rows updated
 */

/**
 * UC15 — sends content to AI moderation (MODERATION_EVENTS_ENABLED=true). Impl:
 * infrastructure/messaging/event-moderation-gateway.js. Flag off -> not injected (null).
 * `revision` is echoed back unchanged by Moderation in the result.
 * @typedef {Object} ModerationGateway
 * @property {(place, tour, revision: string) => Promise<object>} submitPlace  // place.submitted
 * @property {(tour, places, revision: string) => Promise<object>} submitTour  // tour.submitted
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
 * @property {(p: { text: string, from: string, to: string, context?: string }) => Promise<string>} translate
 * @property {(p: { texts: string[], from: string, to: string, context?: string }) => Promise<string[]>} [translateMany]
 *   tuỳ chọn — dịch nhiều đoạn sang một ngôn ngữ trong một lần gọi (cùng thứ tự)
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

/**
 * UC20 (#273) — append-only admin action log (table admin_actions, decision L14). No update, no delete.
 * `append` runs inside the caller's transaction (`tx`) so an action is never saved without its row.
 * @typedef {Object} AdminActionRepository
 * @property {(entry: { adminId, action, targetType, targetId, reason?, data? }, opts?: { tx? }) => Promise<import('../entities/admin-action.js').AdminAction>} append
 * @property {(targetType: string, targetId: string, opts?: { limit?: number }) => Promise<import('../entities/admin-action.js').AdminAction[]>} listByTarget  // newest first
 * @property {(entry: { adminId, action, targetType, targetId, reason?, data?, createdAt? }, sourceKey: string) => Promise<boolean>} appendOnce  // UC22: event-fed row, false when sourceKey exists
 * @property {(id: string) => Promise<import('../entities/admin-action.js').AdminAction|null>} findById
 * @property {(opts?: { skip?: number, take?: number, action?: string, adminId?: string, targetType?: string, targetId?: string, from?: Date|null, to?: Date|null }) => Promise<{ items: import('../entities/admin-action.js').AdminAction[], total: number }>} listRecent  // newest first (UC22), period [from, to)
 */

/**
 * UC22 (#275) — read-only numbers of the admin dashboard and the UC21 violation history.
 * Periods are [from, to) with Date bounds.
 * @typedef {Object} AdminInsightRepository
 * @property {() => Promise<{ pending_review: number, ai_warning: number }>} countReviewQueue
 * @property {(period: { from: Date, to: Date }) => Promise<number|null>} averageReviewSeconds  // UC19 decisions with data.queuedAt
 * @property {(period: { from: Date, to: Date }) => Promise<number>} countReportedTours        // distinct tours, reports created in the period
 * @property {() => Promise<number>} countOpenReportTours
 * @property {(period: { from: Date, to: Date }, opts?: { limit?: number }) => Promise<Array<{ authorId, publicTours, averageRating }>>} topContributors  // decision L14
 * @property {(period: { from: Date, to: Date }) => Promise<Record<string, number>>} countActionsByType
 * @property {(authorId: string) => Promise<Record<string, number>>} countToursByStatus
 * @property {(authorId: string, opts: { limit: number }) => Promise<Array<{ id, title, hiddenAt, reason }>>} listHiddenTours
 * @property {(authorId: string, opts: { limit: number }) => Promise<Array<{ id, title, rejectedAt, reason }>>} listRejectedTours
 * @property {(authorId: string) => Promise<Record<string, number>>} countReportsOnAuthorTours  // by report status
 */

/**
 * UC20 (#273) — admin side of the community reports. The three writes are conditional and run in one
 * transaction with their log row; they return null when the condition no longer holds (409).
 * @typedef {Object} AdminReportRepository
 * @property {(page: { skip: number, take: number }) => Promise<{ items: Array<{ tourId, title, status, authorId, openReportCount, flaggedAt, oldestReportAt, lastReportAt, reasons: Record<string, number> }>, total: number }>} listQueue  // R1 order
 * @property {(tourId: string) => Promise<{ openReportCount: number, flaggedAt: Date|null, open: import('../entities/tour-report.js').TourReport[], counts: { open: number, dismissed: number, actioned: number } }>} getReportState
 * @property {(tourId: string, log: { adminId: string, reason: string }) => Promise<{ fromStatus: string, reportCount: number }|null>} hideIf      // public -> hidden, open reports -> actioned
 * @property {(tourId: string, log: { adminId: string, reason: string|null }) => Promise<{ fromStatus: string }|null>} restoreIf                          // hidden -> public
 * @property {(tourId: string, log: { adminId: string, reason: string|null }) => Promise<{ status: string, reportCount: number }|null>} dismissIf    // open reports -> dismissed, status unchanged
 */

/**
 * UC20 (#273) — tells the contributor (Notification) about a hide / restore.
 * Impl: infrastructure/messaging/event-admin-report-publisher.js. Null when the broker is not loaded.
 * @typedef {Object} AdminReportEvents
 * @property {(tour, reason: string) => Promise<object>} hidden     // tour.hidden
 * @property {(tour, reason: string|null) => Promise<object>} restored // tour.restored
 */

/**
 * UC14 (#269) — restricted access (columns tours.passcode_*, tables tour_access_grants and
 * tour_unlock_attempts). Status writes are conditional (null -> 409 when the state moved); grant and
 * attempt writes never touch tours.updated_at.
 * @typedef {Object} TourAccessRepository
 * @property {(tourId: string) => Promise<{ tourId, authorId, status, passcodeHash: string|null, passcodeVersion: number, passcodeSetAt: Date|null }|null>} findAccess
 * @property {(tourId: string, fromStatuses: string[], fields: { passcodeHash: string, passcodeSetAt: Date }) => Promise<import('../entities/tour.js').Tour|null>} setPasscodeIf  // status IN fromStatuses -> restricted, version + 1, grants deleted
 * @property {(tourId: string) => Promise<import('../entities/tour.js').Tour|null>} clearPasscodeIf  // restricted -> draft, hash cleared, version + 1, grants deleted
 * @property {(tourId: string, userId: string) => Promise<{ tourId, userId, passcodeVersion: number, createdAt: Date }|null>} findGrant
 * @property {(tourId: string, userId: string, passcodeVersion: number) => Promise<void>} saveGrant  // upsert on (tourId, userId)
 * @property {(tourId: string, passcodeVersion: number) => Promise<number>} countGrants
 * @property {(tourId: string, userId: string, since: Date) => Promise<{ id: string, count: number }>} reserveAttempt  // insert one attempt row, then count the rows since `since` (this one included)
 * @property {(id: string) => Promise<void>} releaseAttempt  // a correct or refused attempt is not a failure
 */

/**
 * UC14 (#269) — one-way passcode hashing. Impl: infrastructure/security/scrypt-passcode-hasher.js.
 * @typedef {Object} PasscodeHasher
 * @property {(plain: string) => Promise<string>} hash
 * @property {(plain: string, stored: string|null) => Promise<boolean>} verify
 */

export {};
