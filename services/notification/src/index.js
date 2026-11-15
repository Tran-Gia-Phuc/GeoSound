// =========================================================
// Notification service (UC16 / #270).
//   - HTTP :3006 (only inside the compose network, gateway /api/notifications): the signed-in
//     user's in-app notifications (list, unread count, mark read, mark all read).
//   - RabbitMQ worker: tour result events -> in-app notification for the tour author (contributorId)
//     + email (unchanged). UC23: auth.new_device_login -> security email ("Đăng nhập mới trên ...").
//     UC21: account.moderated -> in-app notification + email to the account owner.
//   A broker outage never takes the HTTP part down (the worker retries, like media).
// Only this file imports ../shared (CI rule); the rest gets verifyJwt injected.
// =========================================================
import express from 'express';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import {
  logger,
  errorHandler,
  verifyJwt,
  setSessionRevocationCheck,
  createRedisRevocationCheck,
} from '../shared/middleware/index.js';
import {
  connect,
  consume,
  stopConsuming,
  close as closeRabbit,
  isReady as rabbitReady,
} from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';
import { registerHealthRoutes, prismaCheck, redisCheck } from '../shared/health/index.js';
import { createShutdown, closeServer } from '../shared/shutdown/index.js';
import { createMailer } from './services/mailer.js';
import { handleEvent } from './notify.js';
import { contributorLookupFromEnv } from './services/contributor-lookup.js';
import { buildContainer } from './container.js';

// UC23 — reject access tokens of signed-out sessions (key revoked:sid:<sid>, written by Auth).
// No offline queue: while Redis is down the check fails at once and verifyJwt fails open.
const revocationRedis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
let redisErrorLogged = false;
revocationRedis.on('error', (err) => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  console.warn(`[notification] Redis unavailable for the session revocation check: ${err.message}`);
});
setSessionRevocationCheck(createRedisRevocationCheck(revocationRedis));

const PORT = process.env.PORT || 3006;
// Graceful shutdown (#348): SIGTERM / SIGINT run the steps registered below the listen() call.
const shutdown = createShutdown({ service: 'notification' });
const prisma = new PrismaClient();
const { notificationRouter, storeInApp } = buildContainer({ prisma, requireAuth: verifyJwt([]) });

const app = express();
app.use(logger);
// /healthz, /health (liveness) and /readyz (#345): the in-app list needs the database, the worker
// needs RabbitMQ; Redis (revocation check, fail open) is only reported.
registerHealthRoutes(app, {
  service: 'notification',
  isDraining: shutdown.isShuttingDown,
  checks: {
    db: { check: prismaCheck(prisma) },
    rabbitmq: { check: rabbitReady },
    redis: { check: redisCheck(revocationRedis), required: false },
  },
});
app.use('/', notificationRouter);
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);
const server = app.listen(PORT, () => console.log(`[notification] http :${PORT}`));

// Requests in flight and the emails being sent finish, then the broker, the database and Redis close.
shutdown
  .add('stop intake', () => Promise.all([closeServer(server), stopConsuming({ timeoutMs: 20000 })]), {
    timeoutMs: 22000,
  })
  .add('rabbitmq', closeRabbit, { timeoutMs: 2000 })
  .add('database', () => prisma.$disconnect(), { timeoutMs: 2000 })
  .add('redis', () => revocationRedis.quit(), { timeoutMs: 2000 });

async function startWorker() {
  await connect();
  const mailer = createMailer();
  // #258 — tour events carry only contributorId: the email is looked up in Auth.
  const lookupEmail = contributorLookupFromEnv();
  if (!lookupEmail) console.warn('[notification] AUTH_SERVICE_URL / INTERNAL_SERVICE_TOKEN missing: no contributor email lookup');
  await consume(
    'notification.events',
    [
      EVENTS.TOUR_AI_REJECTED,
      EVENTS.TOUR_APPROVED,
      EVENTS.TOUR_REJECTED,
      EVENTS.TOUR_CHANGES_REQUESTED,
      EVENTS.TOUR_REPORTED,
      EVENTS.TOUR_HIDDEN,
      EVENTS.TOUR_RESTORED, // UC20 — a hidden tour is public again
      EVENTS.TTS_RENDER_COMPLETED,
      EVENTS.AUTH_NEW_DEVICE_LOGIN, // UC23 / R10 — new-device sign-in alert
      EVENTS.ACCOUNT_MODERATED, // UC21 — admin warned / suspended / banned / restored the account
    ],
    // storeInApp never throws; email errors still propagate exactly as before.
    (event, payload) => handleEvent(mailer, event, payload, console, process.env, { lookupEmail, storeInApp }),
  );
  console.log('[notification] worker started');
}

function startWorkerWithRetry(delayMs = 10000) {
  startWorker().catch((err) => {
    if (shutdown.isShuttingDown()) return; // stopping: no retry
    console.error(`[notification] worker: ${err.message} — retry in ${delayMs / 1000}s`);
    setTimeout(() => startWorkerWithRetry(delayMs), delayMs);
  });
}
startWorkerWithRetry();
