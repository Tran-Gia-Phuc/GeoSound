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
 * listRetryable returns ai_failed cases with updatedAt < failedBefore, plus pending/reviewing cases
 * with updatedAt < staleBefore, oldest first, at most `limit` (sweeper, task #AI-38).
 * @typedef {Object} ModerationRepository
 * @property {(key: {subjectType: string, subjectId: string, revision: string}) => Promise<ModerationCaseRow|null>} find
 * @property {(row: {subjectType: string, subjectId: string, tourId?: string|null, revision: string, payload: object}) => Promise<ModerationCaseRow>} createPending
 * @property {(id: string, patch: Partial<ModerationCaseRow>) => Promise<ModerationCaseRow>} update
 * @property {(opts: {failedBefore: Date, staleBefore: Date, limit?: number}) => Promise<ModerationCaseRow[]>} listRetryable
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
