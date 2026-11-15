// Prometheus implementation of the ModerationMetrics port (deployment task 4.4, plan section 10.2).
// Built from the counter / histogram / gauge factories of shared/metrics createMetrics(), which index.js
// passes through container.js: this module never imports shared/ (CI repo layout, CLAUDE.md section 7).
//
// Every label value is clamped to a closed set, so a bad value never creates a new series and no id
// (place, tour, contributor) can reach a label. No method throws.

export const KINDS = Object.freeze(['place', 'tour']);
export const VERDICTS = Object.freeze(['Pass', 'Warning', 'Reject']);
export const SOURCES = Object.freeze(['ai', 'geo']);
export const AI_FAILURE_REASONS = Object.freeze(['timeout', '503', '401', 'other']);
export const CASE_DURATION_BUCKETS = Object.freeze([1, 5, 15, 30, 60, 120, 300, 900]);

const OTHER = 'other';

/** Value if it is in `allowed`, else `fallback`. */
export const clampLabel = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// An unknown verdict is a doubt, as in merge-verdicts.js: it is counted as a Warning.
const labelsOfCase = ({ kind, verdict, source } = {}) => ({
  kind: clampLabel(kind, KINDS, OTHER),
  verdict: clampLabel(verdict, VERDICTS, 'Warning'),
  source: clampLabel(source, SOURCES, 'ai'),
});

/**
 * @param {{ counter: Function, histogram: Function, gauge: Function }} factories from createMetrics()
 * @param {{ logger?: Pick<Console, 'warn'> }} [opts]
 * @returns {import('../../domain/ports/index.js').ModerationMetrics}
 */
export function createPromModerationMetrics({ counter, histogram, gauge }, { logger = console } = {}) {
  const cases = counter({
    name: 'moderation_cases_total',
    help: 'Moderation cases that got a final verdict. source = the signal that set the final verdict '
      + '(ai or geo); when AI and geo give the same verdict, source is ai.',
    labelNames: ['kind', 'verdict', 'source'],
  });
  const aiFailed = counter({
    name: 'moderation_ai_failed_total',
    help: 'Temporary AI failures after retries that left a case ai_failed (the sweeper retries it). '
      + 'reason: timeout, 503, 401 or other.',
    labelNames: ['kind', 'reason'],
  });
  const duration = histogram({
    name: 'moderation_case_duration_seconds',
    help: 'Seconds from the *.submitted event (its at, else the case creation) to the published result.',
    labelNames: ['kind'],
    buckets: [...CASE_DURATION_BUCKETS],
  });
  const pending = gauge({
    name: 'moderation_pending_cases',
    help: 'Moderation cases in ai_failed waiting for the retry sweeper (set on every sweeper tick).',
    labelNames: [],
  });

  const safe = (fn) => {
    try {
      fn();
    } catch (err) {
      try { logger.warn(`[moderation] metrics update failed: ${err?.message ?? err}`); } catch { /* never throw */ }
    }
  };

  return Object.freeze({
    caseFinished(event = {}) {
      safe(() => {
        const labels = labelsOfCase(event);
        cases.inc(labels);
        if (typeof event.seconds === 'number' && Number.isFinite(event.seconds) && event.seconds >= 0) {
          duration.observe({ kind: labels.kind }, event.seconds);
        }
      });
    },
    aiFailed({ kind, reason } = {}) {
      safe(() => aiFailed.inc({
        kind: clampLabel(kind, KINDS, OTHER),
        reason: clampLabel(reason, AI_FAILURE_REASONS, OTHER),
      }));
    },
    setPending(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return;
      safe(() => pending.set({}, n));
    },
  });
}
