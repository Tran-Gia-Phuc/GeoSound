// =========================================================
// Tour service (UC02,03,07-11,13,17,18). Dùng PostGIS nhiều nhất.
// Hiện có: UC09 CRUD tour; UC10 điểm dừng; UC11 route & vùng kích hoạt;
// UC02 tìm & xem tour công khai; UC12 đa ngôn ngữ & TTS. Ráp router từ container.js.
// Qua gateway: /api/tours/* -> ở đây là /* (vd /api/tours/mine -> /mine).
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';
import { buildContainer } from './container.js';

const app = express();
const PORT = process.env.PORT || 3002;

const { tourRouter, placeRouter, routeConfigRouter, publicTourRouter, languageRouter } =
  buildContainer(process.env);

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tour' }));

// UC02: tìm kiếm (GET /) + chi tiết (GET /:id) công khai — MOUNT TRƯỚC router
// contributor để GET công khai không bị chặn bởi verifyJwt; :id ràng buộc UUID
// nên /mine... rơi xuống các router sau (vẫn giữ verifyJwt của chúng).
app.use('/', publicTourRouter);

// UC09: POST / | GET /mine | GET /mine/:id | PATCH /mine/:id | DELETE /mine/:id
app.use('/', tourRouter);
// UC10: /mine/:tourId/places (+ /:placeId, /reorder)
app.use('/', placeRouter);
// UC11: /mine/:tourId/route-config (GET | PUT)
app.use('/', routeConfigRouter);
// UC12: /mine/:tourId/languages (GET | PUT) + .../places/:placeId/tts-preview,
//       .../places/:placeId/translations/:lang
app.use('/', languageRouter);

// TODO: publish tour.submitted (UC15); "tour gần tôi" chuyển PostGIS khi cần.

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[tour] listening on :${PORT}`));
