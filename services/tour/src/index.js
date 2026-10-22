// =========================================================
// Tour service (UC02,03,07-11,13,17,18). Dùng PostGIS nhiều nhất.
// Hiện có: UC09 — CRUD tour; UC10 — điểm dừng. Ráp router từ container.js.
// Qua gateway: /api/tours/* -> ở đây là /* (vd /api/tours/mine -> /mine).
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';
import { buildContainer } from './container.js';

const app = express();
const PORT = process.env.PORT || 3002;

const { tourRouter, placeRouter } = buildContainer(process.env);

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tour' }));

// UC09: POST / | GET /mine | GET /mine/:id | PATCH /mine/:id | DELETE /mine/:id
app.use('/', tourRouter);
// UC10: /mine/:tourId/places (+ /:placeId, /reorder)
app.use('/', placeRouter);

// TODO: UC02 tìm kiếm công khai (GET / , GET /:id); "tour gần tôi" (PostGIS);
//       UC11 route/vùng kích hoạt; publish tour.submitted (UC15).

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[tour] listening on :${PORT}`));
