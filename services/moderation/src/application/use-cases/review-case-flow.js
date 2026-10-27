// Shared case flow for place and tour reviews (tasks #AI-36, #AI-37, #AI-38).
//
// execute(payload) : save the case first, then claim it (compare-and-set) and review it. A stored result
//                    (done or failed_permanent) is re-published, the AI is not called again (D10).
// retry(row)       : sweeper retry of a pending / reviewing / ai_failed case from its stored payload.
// republish(row)   : sweeper re-publish of a stored result whose publish failed. No AI call.
//
// A subclass gives the subject-specific parts:
//   subjectType, label                 'place' | 'tour'
//   caseKey(payload)                   { subjectId, tourId, revision }
//   tagOf(row) / tagOfPayload(p)       short log tag with ids only, never content
//   check(payload)                     -> { verdict, severity, reasons, model }; throws AiPermanentError /
//                                         AiTemporaryError from the AI
//   permanentResult(payload, err)      -> { verdict, severity, reasons } published for human review on a 422
//   buildResultEvent(case, at)         -> { eventName, payload }
//
// Error policy (D11): AiPermanentError -> failed_permanent + publish permanentResult; AiTemporaryError after
// retries (including 401 config) -> ai_failed, nothing published, the sweeper retries; anything else ->
// ai_failed. No public method ever throws: the shared consume() would drop the message.
import { CASE_STATUS } from '../../domain/entities/moderation-case.js';
import { AiPermanentError, AiTemporaryError } from '../../domain/errors/index.js';
import { transition, canTransition } from '../../domain/moderation/case-state-machine.js';
import { truncate } from '../dtos/ai-mapping.js';

// Event contract limits (shared/events reasonSchema and *.ai_rejected.reason).
export const MAX_REASONS = 50;
export const MAX_REASON_TEXT = 1000;
const MAX_REASON_FIELD = 100;
const MAX_REASON_MESSAGE = 500;
const MAX_LAST_ERROR = 500;

export const REJECT_FALLBACK_REASON = 'Rejected by automatic moderation';
export const PERMANENT_ERROR_SEVERITY = 0.5;
export const STALE_REVIEWING_ERROR = 'Stale reviewing case (no result in time, worker probably crashed); retried by the sweeper';

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

export const errorText = (err) => truncate(`${err?.name ?? 'Error'}${err?.kind ? `(${err.kind})` : ''}: ${err?.message ?? ''}`, MAX_LAST_ERROR);

/**
 * Compare-and-set transition: checks the move with the state machine, then claims the row only if it still has
 * the status and updatedAt we read. Returns the claimed row, or null when another worker changed it first.
 */
export async function claimTransition(repo, row, to, { patch = {}, now }) {
  const next = transition(row, to, patch);
  return repo.claim(row.id, {
    fromStatus: row.status,
    fromUpdatedAt: row.updatedAt,
    toStatus: next.status,
    patch: { ...patch, attempts: next.attempts },
    now,
  });
}

export class ReviewCaseFlow {
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

  /** @param {object} payload a valid *.submitted payload */
  async execute(payload) {
    const tag = this.tagOfPayload(payload);
    const { label } = this;
    let current = null;
    try {
      current = await this.repo.createPending({ subjectType: this.subjectType, ...this.caseKey(payload), payload });

      if (current.status === CASE_STATUS.DONE || current.status === CASE_STATUS.FAILED_PERMANENT) {
        this.logger.info(`[moderation] duplicate ${label} ${tag}: re-publishing stored ${current.verdict}`);
        await this.#publishResult(current, tag);
        return;
      }
      if (!canTransition(current.status, CASE_STATUS.REVIEWING)) {
        // Another delivery is reviewing this revision; a stale one is picked up by the sweeper.
        this.logger.info(`[moderation] ${label} ${tag} already ${current.status}, skipped`);
        return;
      }

      const claimed = await claimTransition(this.repo, current, CASE_STATUS.REVIEWING, { now: this.clock.now() });
      if (!claimed) {
        this.logger.info(`[moderation] ${label} ${tag} claimed by another worker, skipped`);
        return;
      }
      current = null; // #review owns the case from here and handles its own errors
      await this.#review(claimed, payload, tag);
    } catch (err) {
      this.logger.error(`[moderation] ${label} review failed ${tag}: ${errorText(err)}`);
      await this.#markFailed(current, err, tag);
    }
  }

  /**
   * Sweeper retry of a stored case (pending, reviewing or ai_failed), from its stored payload.
   * A stale reviewing case (crash during the AI call) goes reviewing -> ai_failed -> reviewing.
   * Never throws.
   * @returns {Promise<'done'|'failed_permanent'|'ai_failed'|'skipped'|'error'>}
   */
  async retry(row) {
    const tag = this.tagOf(row);
    try {
      const now = this.clock.now();
      let current = row;
      if (current.status === CASE_STATUS.REVIEWING) {
        current = await claimTransition(this.repo, current, CASE_STATUS.AI_FAILED, {
          patch: { lastError: STALE_REVIEWING_ERROR }, now,
        });
        if (!current) return 'skipped';
      }
      if (!canTransition(current.status, CASE_STATUS.REVIEWING)) return 'skipped';
      const claimed = await claimTransition(this.repo, current, CASE_STATUS.REVIEWING, { now });
      if (!claimed) return 'skipped';
      this.logger.info(`[moderation] sweeper retries ${this.label} ${tag}`);
      return await this.#review(claimed, claimed.payload, tag);
    } catch (err) {
      this.logger.error(`[moderation] ${this.label} retry failed ${tag}: ${errorText(err)}`);
      return 'error';
    }
  }

  /**
   * Sweeper re-publish of a stored result (done or failed_permanent) whose publish failed. No AI call.
   * The case is leased first (claim without a status change), so it is re-published by one sweep only.
   * Never throws.
   * @returns {Promise<'republished'|'failed'|'skipped'|'error'>}
   */
  async republish(row) {
    const tag = this.tagOf(row);
    try {
      if (row.status !== CASE_STATUS.DONE && row.status !== CASE_STATUS.FAILED_PERMANENT) return 'skipped';
      const leased = await this.repo.claim(row.id, {
        fromStatus: row.status, fromUpdatedAt: row.updatedAt, now: this.clock.now(),
      });
      if (!leased) return 'skipped';
      this.logger.info(`[moderation] sweeper re-publishes ${this.label} ${tag} stored ${leased.verdict}`);
      return (await this.#publishResult(leased, tag)) ? 'republished' : 'failed';
    } catch (err) {
      this.logger.error(`[moderation] ${this.label} re-publish failed ${tag}: ${errorText(err)}`);
      return 'error';
    }
  }

  // Check + result for a case already claimed in status reviewing. Never throws.
  async #review(reviewing, payload, tag) {
    let current = reviewing;
    try {
      this.logger.info(`[moderation] reviewing ${this.label} ${tag} attempt=${current.attempts}`);
      let result;
      try {
        result = await this.check(payload);
      } catch (err) {
        return await this.#onAiError(current, payload, err, tag);
      }

      current = await this.#save(transition(current, CASE_STATUS.DONE, {
        verdict: result.verdict,
        severity: result.severity,
        reasons: result.reasons,
        model: result.model ?? null,
        lastError: null,
        checkedAt: this.clock.now(),
      }));
      this.logger.info(`[moderation] ${this.label} ${tag} verdict=${result.verdict} severity=${result.severity} model=${current.model}`);
      await this.#publishResult(current, tag);
      return CASE_STATUS.DONE;
    } catch (err) {
      this.logger.error(`[moderation] ${this.label} review failed ${tag}: ${errorText(err)}`);
      await this.#markFailed(current, err, tag);
      return 'error';
    }
  }

  async #onAiError(current, payload, err, tag) {
    if (err instanceof AiPermanentError) {
      this.logger.warn(`[moderation] ${this.label} ${tag} permanent AI error, sent to human review: ${errorText(err)}`);
      const result = this.permanentResult(payload, err);
      const failed = await this.#save(transition(current, CASE_STATUS.FAILED_PERMANENT, {
        verdict: result.verdict,
        severity: result.severity,
        reasons: result.reasons,
        lastError: errorText(err),
        checkedAt: this.clock.now(),
      }));
      await this.#publishResult(failed, tag);
      return CASE_STATUS.FAILED_PERMANENT;
    }
    if (!(err instanceof AiTemporaryError)) throw err; // unexpected: handled by #review()
    this.logger.warn(`[moderation] ${this.label} ${tag} AI unavailable, ai_failed (sweeper retries): ${errorText(err)}`);
    await this.#save(transition(current, CASE_STATUS.AI_FAILED, { lastError: errorText(err) }));
    return CASE_STATUS.AI_FAILED;
  }

  // Publish failure is logged, not thrown: the case keeps publishedAt = null so it can be re-published.
  // Returns true when the event was published.
  async #publishResult(moderationCase, tag) {
    const { eventName, payload } = this.buildResultEvent(moderationCase, this.clock.now().toISOString());
    try {
      await this.publisher.publish(eventName, payload);
    } catch (err) {
      this.logger.error(`[moderation] publish ${eventName} failed ${tag}: ${errorText(err)}`);
      return false;
    }
    if (!moderationCase.publishedAt) await this.repo.update(moderationCase.id, { publishedAt: this.clock.now() });
    return true;
  }

  async #markFailed(current, err, tag) {
    if (!current?.id || !canTransition(current.status, CASE_STATUS.AI_FAILED)) return;
    try {
      await this.#save(transition(current, CASE_STATUS.AI_FAILED, { lastError: errorText(err) }));
    } catch (saveErr) {
      this.logger.error(`[moderation] could not mark ${this.label} ${tag} ai_failed: ${errorText(saveErr)}`);
    }
  }

  async #save(next) {
    return this.repo.update(next.id, next);
  }
}
