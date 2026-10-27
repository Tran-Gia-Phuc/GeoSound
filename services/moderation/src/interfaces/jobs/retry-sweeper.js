// Timer that runs RetryFailedCases every RETRY_SWEEP_INTERVAL_MS (task #AI-38).
// - Never overlaps: a tick is skipped while the previous sweep is still running (AI calls can be slow).
// - Never throws from the timer: errors are logged.
// - Timer functions are injectable so tests use fake timers.

/**
 * @param {{ retryFailedCases: { execute: () => Promise<object> }, intervalMs: number,
 *           logger?: Pick<Console, 'info' | 'error'>,
 *           setIntervalImpl?: typeof setInterval, clearIntervalImpl?: typeof clearInterval }} deps
 * @returns {{ stop: () => void, tick: () => Promise<void> }}
 */
export function startRetrySweeper({
  retryFailedCases, intervalMs, logger = console,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
}) {
  let running = false;
  let stopped = false;

  async function tick() {
    if (stopped || running) return; // no overlap: the next tick tries again
    running = true;
    try {
      await retryFailedCases.execute();
    } catch (err) {
      try { logger.error(`[moderation] sweeper run failed: ${err?.message ?? err}`); } catch { /* never throw */ }
    } finally {
      running = false;
    }
  }

  const handle = setIntervalImpl(() => tick(), intervalMs);
  handle?.unref?.(); // the HTTP server keeps the process alive, not this timer

  return {
    tick,
    stop() {
      stopped = true;
      clearIntervalImpl(handle);
    },
  };
}
