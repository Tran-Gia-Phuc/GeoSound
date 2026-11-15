// Timer that runs RetryFailedCases every RETRY_SWEEP_INTERVAL_MS (task #AI-38).
// - Never overlaps: a tick is skipped while the previous sweep is still running (AI calls can be slow).
// - Never throws from the timer: errors are logged.
// - Timer functions are injectable so tests use fake timers.
// - stop() resolves once the sweep in progress is over (graceful shutdown, issue #348): the cases it
//   is reviewing get their result published before the RabbitMQ channel closes.
// - Optional `lock` (deployment plan task 0.8, issue #354): wraps each sweep so that, with several
//   replicas, only one of them sweeps per interval (index.js passes a Redis lock from shared/lock).

/**
 * @param {{ retryFailedCases: { execute: () => Promise<object> }, intervalMs: number,
 *           logger?: Pick<Console, 'info' | 'error'>,
 *           lock?: (fn: () => Promise<object>) => Promise<unknown>,
 *           setIntervalImpl?: typeof setInterval, clearIntervalImpl?: typeof clearInterval }} deps
 * @returns {{ stop: () => Promise<void>, tick: () => Promise<void> }}
 */
export function startRetrySweeper({
  retryFailedCases, intervalMs, logger = console, lock = (fn) => fn(),
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
}) {
  let running = null; // promise of the sweep in progress
  let stopped = false;

  async function sweep() {
    try {
      await lock(() => retryFailedCases.execute());
    } catch (err) {
      try { logger.error(`[moderation] sweeper run failed: ${err?.message ?? err}`); } catch { /* never throw */ }
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
