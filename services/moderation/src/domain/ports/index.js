// Ports (JSDoc only). Infrastructure implements them; use-cases receive them via constructor.

/**
 * @typedef {Object} ModerationRepository
 * @property {(key: {subjectType: string, subjectId: string, revision: string}) => Promise<object|null>} find
 * @property {(row: object) => Promise<object>} createPending
 * @property {(id: string, patch: object) => Promise<object>} update
 * @property {(opts: {failedBefore: Date, pendingBefore: Date}) => Promise<object[]>} listRetryable
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
