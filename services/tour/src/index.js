// =========================================================
// Tour service (UC02,03,07-11,13,17,18). Dùng PostGIS nhiều nhất.
// Hiện có: UC09 CRUD tour; UC10 điểm dừng; UC11 route & vùng kích hoạt;
// UC02 tìm & xem tour công khai; UC12 đa ngôn ngữ & TTS; UC13 xem thử tour.
// Ráp router từ container.js.
// Qua gateway: /api/tours/* -> ở đây là /* (vd /api/tours/mine -> /mine).
// =========================================================
import express from 'express';
import Redis from 'ioredis';
import {
  logger,
  errorHandler,
  verifyJwt,
  setSessionRevocationCheck,
  createRedisRevocationCheck,
} from '../shared/middleware/index.js';
import { registerHealthRoutes, prismaCheck, redisCheck } from '../shared/health/index.js';
import { buildContainer } from './container.js';
import { prisma } from './infrastructure/persistence/prisma-client.js';
import { isModerationEnabled, isChatbotEventsEnabled } from './config.js';
import {
  MODERATION_RESULT_QUEUE,
  MODERATION_RESULT_BINDINGS,
} from './interfaces/events/moderation-result-handler.js';
import { ADMIN_LOG_QUEUE, ADMIN_LOG_BINDINGS } from './interfaces/events/account-moderated-handler.js';

const app = express();
const PORT = process.env.PORT || 3002;

// UC23 / design 5.3 — reject access tokens of signed-out sessions (key revoked:sid:<sid>, written by
// Auth). No offline queue: while Redis is down the check fails at once and verifyJwt lets the
// request through (fail open) instead of hanging.
const revocationRedis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
let redisErrorLogged = false;
revocationRedis.on('error', (err) => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  console.warn(`[tour] Redis unavailable for the session revocation check: ${err.message}`);
});
setSessionRevocationCheck(createRedisRevocationCheck(revocationRedis));

// UC15 / #240 — RabbitMQ is loaded only when MODERATION_EVENTS_ENABLED=true or
// CHATBOT_EVENTS_ENABLED=true (both off: no connection at all).
const moderationEnabled = isModerationEnabled(process.env);
const chatbotEventsEnabled = isChatbotEventsEnabled(process.env);
const brokerEnabled = moderationEnabled || chatbotEventsEnabled;
const rabbit = brokerEnabled ? await import('../shared/rabbitmq/index.js') : null;
const events = brokerEnabled ? await import('../shared/events/index.js') : null;

const {
  tourRouter,
  placeRouter,
  routeConfigRouter,
  publicTourRouter,
  languageRouter,
  previewRouter,
  itineraryRouter,
  exploreRouter,
  publicItineraryRouter,
  adminReviewRouter,
  tourRatingRouter,
  tourStatsRouter,
  tourReportRouter,
  adminReportRouter,
  adminInsightRouter,
  tourAccessRouter,
  moderationResultHandler,
  accountModeratedHandler,
  purgeActivityMarks,
} = buildContainer(process.env, { publish: rabbit?.publish, validateEvent: events?.validateEvent, verifyJwt });

app.use(express.json());
app.use(logger);

// /healthz, /health (liveness) and /readyz (#345): the database is required; RabbitMQ too when a
// broker flag is on (moderation results, chatbot events); Redis (revocation check, fail open) is
// only reported.
registerHealthRoutes(app, {
  service: 'tour',
  checks: {
    db: { check: prismaCheck(prisma) },
    ...(brokerEnabled ? { rabbitmq: { check: rabbit.isReady } } : {}),
    redis: { check: redisCheck(revocationRedis), required: false },
  },
});

// UC02: tìm kiếm (GET /) + chi tiết (GET /:id) công khai — MOUNT TRƯỚC router
// contributor để GET công khai không bị chặn bởi verifyJwt; :id ràng buộc UUID
// nên /mine... rơi xuống các router sau (vẫn giữ verifyJwt của chúng).
app.use('/', publicTourRouter);

// UC05 (#267): /:id/ratings (public) and /:id/ratings/mine (any signed-in role). BEFORE the
// contributor routers below, whose verifyJwt(['contributor']) on '/' would answer 403 to a tourist.
app.use('/', tourRatingRouter);
// UC17 (#271): POST /:id/activity (public, optional sign-in) and GET /mine/:id/stats (contributor or
// admin, guard per route). BEFORE the contributor routers: their router-level verifyJwt(['contributor'])
// on '/' would answer 401 to an anonymous visitor and 403 to an admin.
app.use('/', tourStatsRouter);
// UC06 (#268): POST /:id/reports and GET /:id/reports/mine (any signed-in role), same reason.
app.use('/', tourReportRouter);
// UC14 (#269): /:id/unlock, /:id/access/mine, /:id/restricted (any signed-in role) and
// /mine/:tourId/access (contributor, owner only), same reason.
app.use('/', tourAccessRouter);

// UC19: admin review queue + decisions (role admin) — /admin/reviews/*. MUST be mounted BEFORE the
// contributor routers below (verifyJwt(['contributor']) at router level on '/' would answer 403 to
// an admin). The public GET /:id above only matches a UUID, so /admin/... never reaches it.
app.use('/admin/reviews', adminReviewRouter);
// UC20 (#273): admin handling of reported tours (role admin) — /admin/reports/*, same reason.
app.use('/admin/reports', adminReportRouter);
// UC22 (#275) / UC21 (#274): /admin/dashboard, /admin/actions(/:id), /admin/users/:userId/violations
// (role admin, guard per route), same reason.
app.use('/admin', adminInsightRouter);

// UC07: khám phá địa điểm lẻ (công khai) + lịch trình. PHẢI mount TRƯỚC các router
// contributor bên dưới: chúng gắn ở '/' và có verifyJwt(['contributor']) cấp router,
// nên mọi request lọt xuống đó (kể cả /places, /itineraries) đều bị 401/403.
app.use('/places', exploreRouter);
// UC07/A4: lịch trình chia sẻ công khai — /itineraries/shared/:token (trước router có auth).
app.use('/itineraries', publicItineraryRouter);
// UC07: lịch trình cá nhân (bất kỳ tài khoản đã đăng nhập) — /itineraries/*
app.use('/itineraries', itineraryRouter);

// UC09: POST / | GET /mine | GET /mine/:id | PATCH /mine/:id | DELETE /mine/:id
app.use('/', tourRouter);
// UC10: /mine/:tourId/places (+ /:placeId, /reorder)
app.use('/', placeRouter);
// UC11: /mine/:tourId/route-config (GET | PUT)
app.use('/', routeConfigRouter);
// UC12: /mine/:tourId/languages (GET | PUT) + .../places/:placeId/tts-preview,
//       .../places/:placeId/translations/:lang
app.use('/', languageRouter);
// UC13: /mine/:tourId/preview (GET) — xem thử tour của chính tác giả
app.use('/', previewRouter);

// TODO: move "tours near me" to PostGIS when needed.

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// UC17 (#271) — delete statistics dedup marks older than 40 days (one minute after start, then hourly).
const purgeMarks = () =>
  purgeActivityMarks
    .execute()
    .then(({ deleted }) => deleted && console.log(`[tour] purged ${deleted} old activity marks`))
    .catch((err) => console.error(`[tour] activity mark purge failed: ${err.message}`));
setTimeout(purgeMarks, 60_000).unref();
setInterval(purgeMarks, 60 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`[tour] listening on :${PORT}`));

// UC15 / #240 — connect to the broker in the background; consume AI results only with the moderation
// flag. A failure never stops HTTP; until connected, publishing fails -> logged only
// (status stays 'checking' / 'ai_checking'; tour.published / tour.unpublished are not sent).
if (brokerEnabled) {
  (async () => {
    try {
      // Waits for the broker (no retry limit); after a loss the helper reconnects and re-registers
      // the consumers (#345).
      await rabbit.connect(undefined, { retries: Infinity, delayMs: 10000 });
      if (moderationResultHandler) {
        await rabbit.consume(MODERATION_RESULT_QUEUE, MODERATION_RESULT_BINDINGS, moderationResultHandler);
      }
      // UC21 / UC22 — account actions published by Auth go to the admin log.
      if (accountModeratedHandler) {
        await rabbit.consume(ADMIN_LOG_QUEUE, ADMIN_LOG_BINDINGS, accountModeratedHandler);
      }
    } catch (err) {
      console.error('[tour] rabbitmq init failed:', err.message);
    }
  })();
}
