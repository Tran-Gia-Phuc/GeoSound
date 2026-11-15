// =========================================================
// Moderation service entry point: starts HTTP (/healthz, /health, /readyz), the RabbitMQ consumers
// (tasks #AI-36, #AI-37) and the retry sweeper (task #AI-38), which takes a Redis lock per run so
// several replicas sweep once per interval (deployment plan task 0.8, issue #354).
// Wiring lives in container.js; this file only starts things. It is the only module that imports shared/
// (it runs in the Docker image, where shared/ sits next to src/); everything else gets it injected.
// =========================================================
import express from 'express';
import Redis from 'ioredis';
import { logger, errorHandler } from '../shared/middleware/index.js';
import {
  connect,
  consume,
  publish,
  stopConsuming,
  close as closeRabbit,
  isReady as rabbitReady,
} from '../shared/rabbitmq/index.js';
import { EVENTS, validateEvent } from '../shared/events/index.js';
import { registerHealthRoutes, prismaCheck, redisCheck } from '../shared/health/index.js';
import { createJobLock } from '../shared/lock/index.js';
import { createShutdown, closeServer } from '../shared/shutdown/index.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { startRetrySweeper } from './interfaces/jobs/retry-sweeper.js';

// Dynamic import: the Prisma client is only loaded by the running service, never by tests
// (they import the modules below this file, not this file).
const { prisma } = await import('./infrastructure/persistence/prisma-client.js');

const config = loadConfig();
// Graceful shutdown (#348): SIGTERM / SIGINT run the steps registered below the listen() call.
const shutdown = createShutdown({ service: 'moderation' });
let sweeper = null;
const app = express();

// Only the sweeper lock uses Redis. No offline queue: while Redis is down a command fails at once and
// the sweep of that tick is skipped (two replicas retrying the same case would call the AI twice).
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
let redisErrorLogged = false;
redis.on('error', (err) => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  console.warn(`[moderation] Redis unavailable for the sweeper lock: ${err.message}`);
});
redis.on('ready', () => { redisErrorLogged = false; });
const jobLock = createJobLock(redis, { service: 'moderation' });
// Renewed while a sweep runs; kept until 80 % of the interval after the start, so the next tick of
// any replica (whatever its timer phase) gets it and there is one sweep per interval.
const sweepLock = (fn) => jobLock.runOnce('moderation:retry-sweep', fn, {
  ttlMs: 30000,
  holdMs: Math.floor(config.sweep.intervalMs * 0.8),
  onRedisError: 'skip',
});

app.use(express.json());
app.use(logger);
// /healthz, /health (liveness) and /readyz (#345): cases live in the database and arrive through
// RabbitMQ, so both are required. Redis (sweeper lock only) is reported.
registerHealthRoutes(app, {
  service: 'moderation',
  isDraining: shutdown.isShuttingDown,
  checks: {
    db: { check: prismaCheck(prisma) },
    rabbitmq: { check: rabbitReady },
    redis: { check: redisCheck(redis), required: false },
  },
});
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = app.listen(config.port, () => console.log(`[moderation] listening on :${config.port}`));

// Stop taking work, let the reviews in flight publish their result (the channel stays open), then
// close. A review still running after 20 s is left: its message goes back to the queue and the case
// (left in 'reviewing') is picked up again by the sweeper of the next instance.
shutdown
  .add('stop intake', () => Promise.all([closeServer(server), stopConsuming({ timeoutMs: 20000 }), sweeper?.stop()]), {
    timeoutMs: 22000,
  })
  .add('rabbitmq', closeRabbit, { timeoutMs: 2000 })
  .add('database', () => prisma.$disconnect(), { timeoutMs: 2000 })
  .add('redis', () => redis.quit(), { timeoutMs: 2000 });

(async () => {
  try {
    // Waits for the broker (no retry limit); after a loss the helper reconnects and
    // re-registers both consumers (#345).
    await connect(undefined, { retries: Infinity, delayMs: 10000 });
    const container = buildContainer({ prisma, publish, validateEvent, config });

    // place.submitted -> place review (prefetch limits concurrent AI calls, D13).
    await consume('moderation.place-submitted', [EVENTS.PLACE_SUBMITTED], container.handlers.placeSubmitted,
      { prefetch: config.prefetch });

    // tour.submitted -> geo rules + AI text check (#AI-37). Same queue name as before.
    await consume('moderation.tour-submitted', [EVENTS.TOUR_SUBMITTED], container.handlers.tourSubmitted,
      { prefetch: config.prefetch });

    // Sweeper: retries ai_failed / stale cases, re-publishes unpublished results (#AI-38, D11).
    sweeper = startRetrySweeper({
      retryFailedCases: container.retryFailedCases,
      intervalMs: config.sweep.intervalMs,
      lock: sweepLock,
    });
  } catch (err) {
    console.error('[moderation] rabbitmq init failed:', err.message);
  }
})();
