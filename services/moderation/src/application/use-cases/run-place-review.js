// Use-case: place.submitted -> save case -> call AI -> publish place.ai_passed | place.ai_rejected (task #AI-36).
//
// - Idempotent per (place, placeId, revision) (D10): a stored result (done or failed_permanent) is
//   re-published as the same event, the AI is not called again.
// - Pass / Warning -> place.ai_passed (warning: verdict === 'Warning'); Reject -> place.ai_rejected.
// - AiPermanentError (422, other 4xx): case failed_permanent, a Warning is published for human review (D11).
// - AiTemporaryError after retries, including 401 config: case ai_failed with lastError, nothing published,
//   the sweeper retries (D11).
// - execute() never throws: the shared consume() would drop the message (nack without requeue).
//
// Publish failure: the case stays done (or failed_permanent) with publishedAt = null. A redelivered or
// duplicate event re-publishes it, and so does the sweeper (republish(), task #AI-38).
// Entering reviewing is a compare-and-set claim (repo.claim), so two deliveries, or a delivery and the
// sweeper (retry(), task #AI-38), never call the AI for the same case at the same time.
// The case flow itself (execute / retry / republish) is shared with the tour review: review-case-flow.js.
//
// Images (phase 2, task #AI-42): the payload images go to the AI in the same call (ai-mapping, max 5) and
// imagesChecked is stored on the case. A place is never Passed with unchecked images: if the AI says Pass but
// checked fewer images than were sent, without an images[n] reason for each missing one, the result is
// downgraded to a Warning for human review. A 503 (or any temporary error) on an image place is ai_failed and
// retried by the sweeper like any other place.
import { MODERATION_EVENTS as EVENTS } from '../events.js';
import { SUBJECT, VERDICT } from '../../domain/entities/moderation-case.js';
import { mergeVerdicts } from '../../domain/moderation/merge-verdicts.js';
import { AI_LIMITS } from '../dtos/ai-mapping.js';
import {
  ReviewCaseFlow, toEventReasons, joinReasons, PERMANENT_ERROR_SEVERITY,
} from './review-case-flow.js';

// Re-exported for older imports (tests, sweeper).
export {
  MAX_REASONS, MAX_REASON_TEXT, REJECT_FALLBACK_REASON, PERMANENT_ERROR_SEVERITY, STALE_REVIEWING_ERROR,
  toEventReasons, joinReasons, claimTransition,
} from './review-case-flow.js';

export const PERMANENT_ERROR_REASON = Object.freeze({
  field: 'description',
  category: 'other',
  message: 'Automatic check could not process this place; needs human review.',
  source: 'ai',
});

export const UNCHECKED_IMAGES_REASON = Object.freeze({
  field: 'images',
  category: 'other',
  message: 'Some images were not checked; needs human review.',
  source: 'ai',
});

const IMAGE_FIELD = /^images\[(\d+)\]$/;

/**
 * Defensive check (never Pass a place whose images were not checked). Returns a Warning signal to merge with
 * the AI result, or null. Only a Pass is downgraded; Warning and Reject already go to a human or are final.
 * @param {object} payload place.submitted payload
 * @param {{ verdict: string, imagesChecked?: number, reasons?: object[] }} aiResult
 */
export function uncheckedImagesSignal(payload, aiResult) {
  if (aiResult?.verdict !== VERDICT.PASS) return null;
  const sent = Math.min(Array.isArray(payload?.images) ? payload.images.length : 0, AI_LIMITS.images);
  if (sent === 0) return null;
  const checked = Number.isInteger(aiResult.imagesChecked) ? aiResult.imagesChecked : 0;
  if (checked >= sent) return null;
  const explained = new Set();
  for (const r of aiResult.reasons ?? []) {
    const m = IMAGE_FIELD.exec(r?.field ?? '');
    if (m && Number(m[1]) < sent) explained.add(Number(m[1]));
  }
  if (explained.size >= sent - checked) return null;
  return {
    verdict: VERDICT.WARNING, severity: PERMANENT_ERROR_SEVERITY, reasons: [{ ...UNCHECKED_IMAGES_REASON }], source: 'ai',
  };
}

/** Builds the result event from a stored case (done or failed_permanent). */
export function buildPlaceResultEvent(moderationCase, at) {
  const ids = { placeId: moderationCase.subjectId, tourId: moderationCase.tourId, revision: moderationCase.revision };
  const reasons = toEventReasons(moderationCase.reasons ?? []);
  if (moderationCase.verdict === VERDICT.REJECT) {
    return {
      eventName: EVENTS.PLACE_AI_REJECTED,
      payload: { ...ids, reason: joinReasons(moderationCase.reasons ?? []), reasons, at },
    };
  }
  return {
    eventName: EVENTS.PLACE_AI_PASSED,
    payload: {
      ...ids,
      warning: moderationCase.verdict === VERDICT.WARNING,
      severity: moderationCase.severity ?? 0,
      reasons,
      at,
    },
  };
}

export class RunPlaceReview extends ReviewCaseFlow {
  subjectType = SUBJECT.PLACE;

  label = 'place';

  caseKey(payload) {
    return { subjectId: payload.placeId, tourId: payload.tourId ?? null, revision: payload.revision };
  }

  tagOfPayload(payload) {
    return `placeId=${payload?.placeId} revision=${payload?.revision}`;
  }

  tagOf(row) {
    return `placeId=${row?.subjectId} revision=${row?.revision}`;
  }

  async check(payload) {
    const aiResult = await this.aiReviewer.reviewPlace(payload);
    const imagesSignal = uncheckedImagesSignal(payload, aiResult);
    if (imagesSignal) {
      this.logger.warn(`[moderation] place ${this.tagOfPayload(payload)} Pass with unchecked images, downgraded to Warning`);
    }
    return {
      ...mergeVerdicts([{ ...aiResult, source: 'ai' }, imagesSignal]),
      model: aiResult.model ?? null,
      imagesChecked: Number.isInteger(aiResult.imagesChecked) ? aiResult.imagesChecked : 0,
    };
  }

  permanentResult() {
    return { verdict: VERDICT.WARNING, severity: PERMANENT_ERROR_SEVERITY, reasons: [{ ...PERMANENT_ERROR_REASON }] };
  }

  buildResultEvent(moderationCase, at) {
    return buildPlaceResultEvent(moderationCase, at);
  }
}
