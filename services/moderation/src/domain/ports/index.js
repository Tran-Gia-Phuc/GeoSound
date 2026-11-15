// Ports (JSDoc only). Infrastructure implements them; use-cases receive them via constructor.

/**
 * A stored case, as a plain object (task #AI-33).
 * @typedef {Object} ModerationCaseRow
 * @property {string} id
 * @property {'place'|'tour'} subjectType
 * @property {string} subjectId
 * @property {string|null} tourId
 * @property {string} revision
 * @property {'pending'|'reviewing'|'done'|'ai_failed'|'failed_permanent'} status
 * @property {'Pass'|'Warning'|'Reject'|null} verdict
 * @property {number|null} severity
 * @property {object[]} reasons
 * @property {number} attempts
 * @property {string|null} model
 * @property {string|null} lastError
 * @property {object} payload       original event payload (the sweeper retries from it)
 * @property {Date|null} publishedAt
 * @property {Date|null} checkedAt
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * Unique key = (subjectType, subjectId, revision).
 * createPending is idempotent: if the key already exists it returns the existing row unchanged.
 * update only writes known mutable fields and refreshes updatedAt.
 * listRetryable returns, oldest first, at most `limit` (sweeper, task #AI-38):
 *   - ai_failed cases with updatedAt < failedBefore,
 *   - pending/reviewing cases with updatedAt < staleBefore (crash before or during the AI call),
 *   - done/failed_permanent cases with publishedAt null and updatedAt < staleBefore (publish failed).
 * claim is a compare-and-set: it writes `toStatus` (default: unchanged), the mutable fields of `patch` and
 * updatedAt = now only if the row still has fromStatus and fromUpdatedAt; it returns the updated row, or null
 * when someone else changed the case first. Two sweeps, or a sweep and a consumer, never process one case at once.
 * @typedef {Object} ModerationRepository
 * @property {(key: {subjectType: string, subjectId: string, revision: string}) => Promise<ModerationCaseRow|null>} find
 * @property {(row: {subjectType: string, subjectId: string, tourId?: string|null, revision: string, payload: object}) => Promise<ModerationCaseRow>} createPending
 * @property {(id: string, patch: Partial<ModerationCaseRow>) => Promise<ModerationCaseRow>} update
 * @property {(opts: {failedBefore: Date, staleBefore: Date, limit?: number}) => Promise<ModerationCaseRow[]>} listRetryable
 * @property {(id: string, opts: {fromStatus: string, fromUpdatedAt: Date, toStatus?: string, patch?: Partial<ModerationCaseRow>, now?: Date}) => Promise<ModerationCaseRow|null>} claim
 */

/**
 * @typedef {Object} AiReviewer
 * @property {(place: object) => Promise<{verdict: string, severity: number, reasons: object[], imagesChecked: number, model: string}>} reviewPlace
 * @property {(tour: object) => Promise<{verdict: string, severity: number, reasons: object[], model: string}>} reviewTour
 */

/**
 * @typedef {Object} EventPublisher
 * @property {(eventName: string, payload: object) => Promise<void>} publish  // validates with zod
 */

/** @typedef {{ now: () => Date }} Clock */

export {};
