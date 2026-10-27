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
import { MODERATION_EVENTS as EVENTS } from '../events.js';
import { SUBJECT, VERDICT } from '../../domain/entities/moderation-case.js';
import { mergeVerdicts } from '../../domain/moderation/merge-verdicts.js';
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
    return { ...mergeVerdicts([{ ...aiResult, source: 'ai' }]), model: aiResult.model ?? null };
  }

  permanentResult() {
    return { verdict: VERDICT.WARNING, severity: PERMANENT_ERROR_SEVERITY, reasons: [{ ...PERMANENT_ERROR_REASON }] };
  }

  buildResultEvent(moderationCase, at) {
    return buildPlaceResultEvent(moderationCase, at);
  }
}
