// =========================================================
// Notification service (UC16 / #270).
//   - HTTP :3006 (only inside the compose network, gateway /api/notifications): the signed-in
//     user's in-app notifications (list, unread count, mark read, mark all read).
//   - RabbitMQ worker: tour result events -> in-app notification for the tour author (contributorId)
//     + email (unchanged). UC23: auth.new_device_login -> security email ("Đăng nhập mới trên ...").
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
import { connect, consume } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';
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
const prisma = new PrismaClient();
const { notificationRouter, storeInApp } = buildContainer({ prisma, requireAuth: verifyJwt([]) });

const app = express();
app.use(logger);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification' }));
app.use('/', notificationRouter);
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);
app.listen(PORT, () => console.log(`[notification] http :${PORT}`));

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
      EVENTS.TTS_RENDER_COMPLETED,
      EVENTS.AUTH_NEW_DEVICE_LOGIN, // UC23 / R10 — new-device sign-in alert
    ],
    // storeInApp never throws; email errors still propagate exactly as before.
    (event, payload) => handleEvent(mailer, event, payload, console, process.env, { lookupEmail, storeInApp }),
  );
  console.log('[notification] worker started');
}

function startWorkerWithRetry(delayMs = 10000) {
  startWorker().catch((err) => {
    console.error(`[notification] worker: ${err.message} — retry in ${delayMs / 1000}s`);
    setTimeout(() => startWorkerWithRetry(delayMs), delayMs);
  });
}
startWorkerWithRetry();
