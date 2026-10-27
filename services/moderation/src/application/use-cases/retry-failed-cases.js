// Sweeper use-case (task #AI-38, D11): picks up cases the normal flow could not finish.
//
//   ai_failed older than failedAfterMs          -> AI review again from the stored payload
//   pending / reviewing older than staleAfterMs -> AI review again (crash before / during the AI call;
//                                                  reviewing goes reviewing -> ai_failed -> reviewing)
//   done / failed_permanent, publishedAt null,
//   older than staleAfterMs                     -> re-publish the stored result, no AI call
//
// The work itself lives in RunPlaceReview (retry / republish) so the logic is not duplicated. Every status
// change there is a compare-and-set claim, so two sweeps (or a sweep and a consumer) never process the same
// case at once: the loser gets null and the case is counted as skipped.
// A successful retry publishes exactly once. execute() never throws (it runs from a timer).
import { CASE_STATUS, SUBJECT } from '../../domain/entities/moderation-case.js';

export const DEFAULT_BATCH_SIZE = 10;

const RETRY_OUTCOME = Object.freeze({
  [CASE_STATUS.DONE]: 'retried',
  [CASE_STATUS.FAILED_PERMANENT]: 'retried',
  skipped: 'skipped',
});
const REPUBLISH_OUTCOME = Object.freeze({ republished: 'republished', skipped: 'skipped' });

export class RetryFailedCases {
  /**
   * @param {{ repo: import('../../domain/ports/index.js').ModerationRepository,
   *           runPlaceReview: { retry: (row: object) => Promise<string>, republish: (row: object) => Promise<string> },
   *           clock: import('../../domain/ports/index.js').Clock,
   *           config: { failedAfterMs: number, staleAfterMs?: number, batchSize?: number },
   *           logger?: Pick<Console, 'info' | 'warn' | 'error'> & { debug?: (m: string) => void } }} deps
   */
  constructor({ repo, runPlaceReview, clock, config, logger = console }) {
    const { failedAfterMs, staleAfterMs = failedAfterMs, batchSize = DEFAULT_BATCH_SIZE } = config;
    Object.assign(this, { repo, runPlaceReview, clock, logger, failedAfterMs, staleAfterMs, batchSize });
  }

  /** @returns {Promise<{ retried: number, republished: number, skipped: number, failed: number }>} */
  async execute() {
    const counts = { retried: 0, republished: 0, skipped: 0, failed: 0 };
    let rows;
    try {
      const now = this.clock.now().getTime();
      rows = await this.repo.listRetryable({
        failedBefore: new Date(now - this.failedAfterMs),
        staleBefore: new Date(now - this.staleAfterMs),
        limit: this.batchSize,
      });
    } catch (err) {
      this.logger.error(`[moderation] sweeper could not list retryable cases: ${err?.message ?? err}`);
      return counts;
    }

    for (const row of rows) {
      let outcome;
      try {
        outcome = await this.#process(row);
      } catch (err) {
        this.logger.error(`[moderation] sweeper failed on case ${row?.id}: ${err?.message ?? err}`);
        outcome = 'failed';
      }
      counts[outcome] += 1;
    }
    if (rows.length > 0) {
      this.logger.info(`[moderation] sweeper done: retried=${counts.retried} republished=${counts.republished}`
        + ` skipped=${counts.skipped} failed=${counts.failed}`);
    }
    return counts;
  }

  async #process(row) {
    if (row.subjectType !== SUBJECT.PLACE) {
      // TODO(#AI-37, issue #178): retry / re-publish tour cases once RunTourReview exists.
      this.logger.debug?.(`[moderation] sweeper skips ${row.subjectType} case ${row.subjectId}: not supported yet (#AI-37)`);
      return 'skipped';
    }
    if (row.status === CASE_STATUS.DONE || row.status === CASE_STATUS.FAILED_PERMANENT) {
      return REPUBLISH_OUTCOME[await this.runPlaceReview.republish(row)] ?? 'failed';
    }
    // pending, reviewing, ai_failed. 'ai_failed' (AI still down) and 'error' count as failed.
    return RETRY_OUTCOME[await this.runPlaceReview.retry(row)] ?? 'failed';
  }
}
