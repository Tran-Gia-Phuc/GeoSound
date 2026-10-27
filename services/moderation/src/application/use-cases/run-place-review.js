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
// duplicate event re-publishes it; the sweeper (#AI-38) must also pick up such cases.
// Known limit: the repository port has no compare-and-set, so two concurrent deliveries of the same
// revision can both call the AI; the result is the same case and Tour ignores the duplicate event.
import { MODERATION_EVENTS as EVENTS } from '../events.js';
import { CASE_STATUS, SUBJECT, VERDICT } from '../../domain/entities/moderation-case.js';
import { AiPermanentError, AiTemporaryError } from '../../domain/errors/index.js';
import { transition, canTransition } from '../../domain/moderation/case-state-machine.js';
import { mergeVerdicts } from '../../domain/moderation/merge-verdicts.js';
import { truncate } from '../dtos/ai-mapping.js';

// Event contract limits (shared/events reasonSchema and place.ai_rejected.reason).
export const MAX_REASONS = 50;
export const MAX_REASON_TEXT = 1000;
const MAX_REASON_FIELD = 100;
const MAX_REASON_MESSAGE = 500;
const MAX_LAST_ERROR = 500;

export const REJECT_FALLBACK_REASON = 'Rejected by automatic moderation';
export const PERMANENT_ERROR_SEVERITY = 0.5;
export const PERMANENT_ERROR_REASON = Object.freeze({
  field: 'description',
  category: 'other',
  message: 'Automatic check could not process this place; needs human review.',
  source: 'ai',
});

/** Reasons as the event contract accepts them: at most 50, field/message cut to their limits. */
export function toEventReasons(reasons = []) {
  return reasons.slice(0, MAX_REASONS).map((r) => {
    const out = {
      field: truncate(r.field, MAX_REASON_FIELD),
      category: r.category,
      message: truncate(r.message, MAX_REASON_MESSAGE),
      source: r.source,
    };
    if (typeof r.severity === 'number') out.severity = r.severity;
    return out;
  });
}

/** Reject reason string: messages joined with '; ', at most 1000 characters, never empty. */
export function joinReasons(reasons = []) {
  const text = reasons.map((r) => r?.message).filter((m) => typeof m === 'string' && m.trim()).join('; ');
  return text ? truncate(text, MAX_REASON_TEXT) : REJECT_FALLBACK_REASON;
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

const errorText = (err) => truncate(`${err?.name ?? 'Error'}${err?.kind ? `(${err.kind})` : ''}: ${err?.message ?? ''}`, MAX_LAST_ERROR);

export class RunPlaceReview {
  /**
   * @param {{ repo: import('../../domain/ports/index.js').ModerationRepository,
   *           aiReviewer: import('../../domain/ports/index.js').AiReviewer,
   *           publisher: import('../../domain/ports/index.js').EventPublisher,
   *           clock: import('../../domain/ports/index.js').Clock,
   *           logger?: Pick<Console, 'info' | 'warn' | 'error'> }} deps
   */
  constructor({ repo, aiReviewer, publisher, clock, logger = console }) {
    Object.assign(this, { repo, aiReviewer, publisher, clock, logger });
  }

  /** @param {object} payload a valid place.submitted payload */
  async execute(payload) {
    const tag = `placeId=${payload?.placeId} revision=${payload?.revision}`;
    let current = null;
    try {
      current = await this.repo.createPending({
        subjectType: SUBJECT.PLACE,
        subjectId: payload.placeId,
        tourId: payload.tourId ?? null,
        revision: payload.revision,
        payload,
      });

      if (current.status === CASE_STATUS.DONE || current.status === CASE_STATUS.FAILED_PERMANENT) {
        this.logger.info(`[moderation] duplicate place ${tag}: re-publishing stored ${current.verdict}`);
        await this.#publishResult(current, tag);
        return;
      }
      if (!canTransition(current.status, CASE_STATUS.REVIEWING)) {
        // Another delivery is reviewing this revision; a stale one is picked up by the sweeper.
        this.logger.info(`[moderation] place ${tag} already ${current.status}, skipped`);
        return;
      }

      current = await this.#save(transition(current, CASE_STATUS.REVIEWING));
      this.logger.info(`[moderation] reviewing place ${tag} attempt=${current.attempts}`);

      let aiResult;
      try {
        aiResult = await this.aiReviewer.reviewPlace(payload);
      } catch (err) {
        await this.#onAiError(current, err, tag);
        return;
      }

      const merged = mergeVerdicts([{ ...aiResult, source: 'ai' }]);
      current = await this.#save(transition(current, CASE_STATUS.DONE, {
        verdict: merged.verdict,
        severity: merged.severity,
        reasons: merged.reasons,
        model: aiResult.model ?? null,
        lastError: null,
        checkedAt: this.clock.now(),
      }));
      this.logger.info(`[moderation] place ${tag} verdict=${merged.verdict} severity=${merged.severity} model=${current.model}`);
      await this.#publishResult(current, tag);
    } catch (err) {
      this.logger.error(`[moderation] place review failed ${tag}: ${errorText(err)}`);
      await this.#markFailed(current, err, tag);
    }
  }

  async #onAiError(current, err, tag) {
    if (err instanceof AiPermanentError) {
      this.logger.warn(`[moderation] place ${tag} permanent AI error, sent to human review: ${errorText(err)}`);
      const failed = await this.#save(transition(current, CASE_STATUS.FAILED_PERMANENT, {
        verdict: VERDICT.WARNING,
        severity: PERMANENT_ERROR_SEVERITY,
        reasons: [{ ...PERMANENT_ERROR_REASON }],
        lastError: errorText(err),
        checkedAt: this.clock.now(),
      }));
      await this.#publishResult(failed, tag);
      return;
    }
    if (!(err instanceof AiTemporaryError)) throw err; // unexpected: handled by execute()
    this.logger.warn(`[moderation] place ${tag} AI unavailable, ai_failed (sweeper retries): ${errorText(err)}`);
    await this.#save(transition(current, CASE_STATUS.AI_FAILED, { lastError: errorText(err) }));
  }

  // Publish failure is logged, not thrown: the case keeps publishedAt = null so it can be re-published.
  async #publishResult(moderationCase, tag) {
    const { eventName, payload } = buildPlaceResultEvent(moderationCase, this.clock.now().toISOString());
    try {
      await this.publisher.publish(eventName, payload);
    } catch (err) {
      this.logger.error(`[moderation] publish ${eventName} failed ${tag}: ${errorText(err)}`);
      return;
    }
    if (!moderationCase.publishedAt) await this.repo.update(moderationCase.id, { publishedAt: this.clock.now() });
  }

  async #markFailed(current, err, tag) {
    if (!current?.id || !canTransition(current.status, CASE_STATUS.AI_FAILED)) return;
    try {
      await this.#save(transition(current, CASE_STATUS.AI_FAILED, { lastError: errorText(err) }));
    } catch (saveErr) {
      this.logger.error(`[moderation] could not mark place ${tag} ai_failed: ${errorText(saveErr)}`);
    }
  }

  async #save(next) {
    return this.repo.update(next.id, next);
  }
}
