// Graceful shutdown shared by the Node services (deployment plan task 0.5, issue #348).
//
// On SIGTERM (docker stop, a Kubernetes pod deletion) or SIGINT the registered steps run once, in
// the order they were added, then the process exits 0. Each step can have its own time limit; a
// failing or slow step is logged and the next one runs. If everything together takes longer than
// `timeoutMs` the process exits 1 (Kubernetes would send SIGKILL soon anyway). A second signal
// exits at once.
//
// While it runs, isShuttingDown() is true: /readyz answers 503 so no new traffic is routed here.
// `delayMs` (env SHUTDOWN_DELAY_MS, default 0) waits before the first step, so a load balancer that
// polls /readyz stops sending traffic before the HTTP server closes (set it in Kubernetes; compose
// has no load balancer and keeps 0).

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 28000; // under the 30 s default grace period of k8s

/** Resolves `true` when `promise` settles in time, `false` on timeout; never rejects. */
async function within(promise, timeoutMs) {
  if (!timeoutMs) {
    await promise;
    return true;
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ service: string, timeoutMs?: number, delayMs?: number, signals?: string[],
 *           log?: Pick<Console, 'log' | 'warn' | 'error'>, exit?: (code: number) => void,
 *           proc?: { on: Function } }} options
 */
export function createShutdown({
  service,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  delayMs = Number(process.env.SHUTDOWN_DELAY_MS) || 0,
  signals = ['SIGTERM', 'SIGINT'],
  log = console,
  exit = (code) => process.exit(code),
  proc = process,
} = {}) {
  if (!service) throw new Error('createShutdown: service is required');
  const steps = [];
  let running = null;

  async function runStep({ name, fn, timeoutMs: stepTimeout }) {
    const t0 = Date.now();
    try {
      const done = await within(Promise.resolve().then(fn), stepTimeout);
      if (!done) log.warn(`[${service}] shutdown: ${name} did not finish in ${stepTimeout} ms, going on`);
      else log.log(`[${service}] shutdown: ${name} done (${Date.now() - t0} ms)`);
    } catch (err) {
      log.warn(`[${service}] shutdown: ${name} failed: ${err?.message ?? err}`);
    }
  }

  const api = {
    isShuttingDown: () => running !== null,

    /** Adds a step; `timeoutMs` limits this step only. Returns the api (chainable). */
    add(name, fn, { timeoutMs: stepTimeout } = {}) {
      steps.push({ name, fn, timeoutMs: stepTimeout });
      return api;
    },

    /** Runs the steps once (later calls return the same promise), then exits. */
    run(reason = 'shutdown') {
      if (running) return running;
      running = (async () => {
        const t0 = Date.now();
        log.log(`[${service}] ${reason}: shutting down`);
        const all = (async () => {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          for (const step of steps) await runStep(step);
        })();
        const inTime = await within(all, timeoutMs);
        if (!inTime) {
          log.error(`[${service}] shutdown took more than ${timeoutMs} ms, exiting now`);
          exit(1);
          return 1;
        }
        log.log(`[${service}] shutdown complete (${Date.now() - t0} ms)`);
        exit(0);
        return 0;
      })();
      return running;
    },
  };

  for (const signal of signals) {
    proc.on(signal, () => {
      if (running) {
        log.warn(`[${service}] ${signal} again: exiting now`);
        exit(1);
        return;
      }
      api.run(signal);
    });
  }
  return api;
}

/**
 * Stops an http.Server: no new connections, idle keep-alive sockets closed at once, requests in
 * flight may finish. After `timeoutMs` the remaining sockets (long polls, SSE) are closed.
 */
export function closeServer(server, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, timeoutMs);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections?.();
  });
}
