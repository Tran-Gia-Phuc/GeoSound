// =========================================================
// API Gateway — 1 cửa vào public (:8080).
// Nhiệm vụ: log, rate-limit (Redis), route tới service nội bộ.
// (Verify JWT ở gateway sẽ bổ sung khi Auth service có token thật.)
// =========================================================
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { rateLimit } from './rate-limit.js';

const app = express();
const PORT = process.env.GATEWAY_PORT || 8080;

const TARGETS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://auth:3001',
  tour: process.env.TOUR_SERVICE_URL || 'http://tour:3002',
  moderation: process.env.MODERATION_SERVICE_URL || 'http://moderation:3003',
};

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

app.use(rateLimit);

// Route /api/<service>/* -> service tương ứng, cắt bỏ tiền tố /api/<service>.
const mount = (path, target) =>
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (p) => p.replace(path, '') || '/',
    })
  );

// Giữ nguyên segment sau /api (vd /api/itineraries -> /itineraries) để tour
// service phân tách namespace với /api/tours (tránh đụng route /:id công khai).
const mountKeep = (path, target) =>
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (p) => p.replace('/api', '') || '/',
    })
  );

mount('/api/auth', TARGETS.auth);
mount('/api/tours', TARGETS.tour);
// UC07 — lịch trình cá nhân + khám phá địa điểm lẻ (cùng tour service).
mountKeep('/api/itineraries', TARGETS.tour);
mountKeep('/api/places', TARGETS.tour);
mount('/api/moderation', TARGETS.moderation);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log('[gateway] routes: /api/auth /api/tours /api/itineraries /api/places /api/moderation');
});
