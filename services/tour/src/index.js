// =========================================================
// Tour service (UC02,03,07-11,13,17,18). Dùng PostGIS nhiều nhất.
// Hiện có: UC09 CRUD tour; UC10 điểm dừng; UC11 route & vùng kích hoạt;
// UC02 tìm & xem tour công khai; UC12 đa ngôn ngữ & TTS; UC13 xem thử tour.
// Ráp router từ container.js.
// Qua gateway: /api/tours/* -> ở đây là /* (vd /api/tours/mine -> /mine).
// =========================================================
import express from 'express';
import { logger, errorHandler, verifyJwt } from '../shared/middleware/index.js';
import { buildContainer } from './container.js';
import { isModerationEnabled, isChatbotEventsEnabled } from './config.js';
import {
  MODERATION_RESULT_QUEUE,
  MODERATION_RESULT_BINDINGS,
} from './interfaces/events/moderation-result-handler.js';

const app = express();
const PORT = process.env.PORT || 3002;

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
  moderationResultHandler,
} = buildContainer(process.env, { publish: rabbit?.publish, validateEvent: events?.validateEvent, verifyJwt });

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tour' }));

// UC02: tìm kiếm (GET /) + chi tiết (GET /:id) công khai — MOUNT TRƯỚC router
// contributor để GET công khai không bị chặn bởi verifyJwt; :id ràng buộc UUID
// nên /mine... rơi xuống các router sau (vẫn giữ verifyJwt của chúng).
app.use('/', publicTourRouter);

// UC19: admin review queue + decisions (role admin) — /admin/reviews/*. MUST be mounted BEFORE the
// contributor routers below (verifyJwt(['contributor']) at router level on '/' would answer 403 to
// an admin). The public GET /:id above only matches a UUID, so /admin/... never reaches it.
app.use('/admin/reviews', adminReviewRouter);

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

app.listen(PORT, () => console.log(`[tour] listening on :${PORT}`));

// UC15 / #240 — connect to the broker in the background; consume AI results only with the moderation
// flag. A failure never stops HTTP; until connected, publishing fails -> logged only
// (status stays 'checking' / 'ai_checking'; tour.published / tour.unpublished are not sent).
if (brokerEnabled) {
  (async () => {
    try {
      await rabbit.connect();
      if (moderationResultHandler) {
        await rabbit.consume(MODERATION_RESULT_QUEUE, MODERATION_RESULT_BINDINGS, moderationResultHandler);
      }
    } catch (err) {
      console.error('[tour] rabbitmq init failed:', err.message);
    }
  })();
}
