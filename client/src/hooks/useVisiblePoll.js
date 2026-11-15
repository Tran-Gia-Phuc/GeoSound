// =========================================================
// useVisiblePoll — run `task` every `intervalMs` while `enabled` and the page is visible
// (UC15 #114 long-running AI check, #137 places being scanned).
//   - stops while the tab is hidden, polls once right away when it becomes visible again
//   - stops when `enabled` turns false (the caller sees the status change)
//   - a failed poll stops the loop and exposes the error; retry() polls again at once
// The task decides what a result means; this hook never synthesizes one.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * @param {() => Promise<unknown>} task
 * @param {{ enabled: boolean, intervalMs: number }} opts
 * @returns {{ error: Error|null, retry: () => void }}
 */
export function useVisiblePoll(task, { enabled, intervalMs }) {
  const taskRef = useRef(task);
  taskRef.current = task;
  const [error, setError] = useState(null);
  const [round, setRound] = useState(0); // bumped by retry() to restart the loop

  // Nothing to poll any more: forget an old failure.
  useEffect(() => {
    if (!enabled) setError(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || error) return undefined;
    let timer = null;
    let stopped = false;
    let running = false;

    const schedule = (delay) => {
      clearTimeout(timer);
      if (!stopped && isVisible()) timer = setTimeout(tick, delay);
    };
    async function tick() {
      if (stopped || running || !isVisible()) return;
      running = true;
      try {
        await taskRef.current();
        running = false;
        schedule(intervalMs);
      } catch (e) {
        running = false;
        if (!stopped) setError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    function onVisibility() {
      if (isVisible()) schedule(0);
      else clearTimeout(timer);
    }

    // A retry polls right away; a fresh start waits one interval (the screen just loaded the data).
    schedule(round > 0 ? 0 : intervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, error, intervalMs, round]);

  const retry = useCallback(() => {
    setError(null);
    setRound((r) => r + 1);
  }, []);

  return { error, retry };
}
