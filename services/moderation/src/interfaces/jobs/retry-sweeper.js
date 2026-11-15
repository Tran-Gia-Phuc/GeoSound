// Timer that runs RetryFailedCases every RETRY_SWEEP_INTERVAL_MS (task #AI-38).
// - Never overlaps: a tick is skipped while the previous sweep is still running (AI calls can be slow).
// - Never throws from the timer: errors are logged.
// - Timer functions are injectable so tests use fake timers.
// - stop() resolves once the sweep in progress is over (graceful shutdown, issue #348): the cases it
//   is reviewing get their result published before the RabbitMQ channel closes.
// - Optional `lock` (deployment plan task 0.8, issue #354): wraps each sweep so that, with several
//   replicas, only one of them sweeps per interval (index.js passes a Redis lock from shared/lock).
// - Optional `metrics` (deployment task 4.4): after each sweep, every replica (lock or not) sets the
//   moderation_pending_cases gauge from retryFailedCases.countPending() (ai_failed cases in the database).
import { NOOP_MODERATION_METRICS } from '../../domain/ports/index.js';

/**
 * @param {{ retryFailedCases: { execute: () => Promise<object>, countPending?: () => Promise<number> },
 *           intervalMs: number,
 *           logger?: Pick<Console, 'info' | 'error'>,
 *           lock?: (fn: () => Promise<object>) => Promise<unknown>,
 *           metrics?: import('../../domain/ports/index.js').ModerationMetrics,
 *           setIntervalImpl?: typeof setInterval, clearIntervalImpl?: typeof clearInterval }} deps
 * @returns {{ stop: () => Promise<void>, tick: () => Promise<void> }}
 */
export function startRetrySweeper({
  retryFailedCases, intervalMs, logger = console, lock = (fn) => fn(), metrics = NOOP_MODERATION_METRICS,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
}) {
  let running = null; // promise of the sweep in progress
  let stopped = false;

  const logError = (msg) => { try { logger.error(msg); } catch { /* never throw */ } };

  async function updatePending() {
    if (typeof retryFailedCases.countPending !== 'function') return;
    try {
      metrics.setPending(await retryFailedCases.countPending());
    } catch (err) {
      logError(`[moderation] sweeper could not count pending cases: ${err?.message ?? err}`);
    }
  }

  async function sweep() {
    try {
      await lock(() => retryFailedCases.execute());
    } catch (err) {
      logError(`[moderation] sweeper run failed: ${err?.message ?? err}`);
    }
    try {
      await updatePending();
    } finally {
      running = null;
    }
  }

  async function tick() {
    if (stopped || running) return; // no overlap: the next tick tries again
    running = sweep();
    await running;
  }

  const handle = setIntervalImpl(() => tick(), intervalMs);
  handle?.unref?.(); // the HTTP server keeps the process alive, not this timer

  return {
    tick,
    async stop() {
      stopped = true;
      clearIntervalImpl(handle);
      await running;
    },
  };
}
