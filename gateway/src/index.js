// =========================================================
// API Gateway — 1 cửa vào public (:8080).
// Nhiệm vụ: log, rate-limit (Redis), route tới service nội bộ.
// (Verify JWT ở gateway sẽ bổ sung khi Auth service có token thật.)
// =========================================================
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { rateLimit, getRedis } from './rate-limit.js';
import { createGeocoder } from './geocode.js';
import { mountChat } from './chat.js';
import { createChatRateLimit, createRedisStore } from './chat-rate-limit.js';

const app = express();
const PORT = process.env.GATEWAY_PORT || 8080;

const TARGETS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://auth:3001',
  tour: process.env.TOUR_SERVICE_URL || 'http://tour:3002',
  moderation: process.env.MODERATION_SERVICE_URL || 'http://moderation:3003',
  media: process.env.MEDIA_SERVICE_URL || 'http://media:3005',
  ai: process.env.AI_SERVICE_URL || 'http://ai:3004',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification:3006',
};
const CHATBOT_ENABLED = process.env.CHATBOT_ENABLED === 'true';
let shuttingDown = false; // graceful shutdown (#348): /readyz answers 503 'draining'

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Deployment plan task 0.4 (#345). The gateway image has no shared/, so the routes are inline
// (same shape as shared/health). /healthz = liveness; /health is its alias. /readyz never
// answers 503 for Redis: it is fail-open here (rate limit, chat limit), so it is only reported.
// It answers 503 'draining' once a shutdown has started (#348).
const liveness = (_req, res) => res.json({ status: 'ok', service: 'gateway' });
app.get('/healthz', liveness);
app.get('/health', liveness);
app.get('/readyz', async (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'draining', service: 'gateway' });
  const redis = getRedis();
  let up = false;
  if (redis?.status === 'ready') {
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000, 'timeout').unref());
    up = (await Promise.race([redis.ping().catch(() => 'error'), timeout])) === 'PONG';
  }
  res.json({ status: 'ready', service: 'gateway', checks: { redis: up ? 'ok' : 'down' } });
});

app.use(rateLimit);

// UC10 — tìm địa chỉ để đặt điểm dừng (proxy Nominatim có cache + giới hạn 1 req/s).
const geocoder = createGeocoder({ userAgent: process.env.GEOCODER_USER_AGENT || undefined });
app.get('/api/geocode', geocoder.handler);

// Chatbot (#188): only when CHATBOT_ENABLED=true; otherwise /api/chat stays 404.
// SSE proxy without buffering; the gateway adds x-internal-token and a per-IP chat limit.
mountChat(app, {
  enabled: CHATBOT_ENABLED,
  target: TARGETS.ai,
  token: process.env.INTERNAL_SERVICE_TOKEN || '',
  limiter: createChatRateLimit({
    store: createRedisStore(getRedis),
    perMin: Number(process.env.CHAT_RATE_LIMIT_PER_MIN) || 5,
    perDay: Number(process.env.CHAT_RATE_LIMIT_PER_DAY) || 100,
  }),
});

// Route /api/<service>/* -> service tương ứng, cắt bỏ tiền tố /api/<service>.
const mount = (path, target, extra = {}) =>
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (p) => p.replace(path, '') || '/',
      ...extra,
    })
  );

// Giữ nguyên segment sau /api (vd /api/itineraries -> /itineraries) để tour
// service phân tách namespace với /api/tours (tránh đụng route /:id công khai).
// LƯU Ý: app.use(path) đã cắt `path` khỏi req.url trước khi tới proxy, nên phải
// dựng lại từ req.originalUrl — nếu không /api/places?x bị chuyển thành /?x
// (rơi vào tìm kiếm tour) và /api/itineraries thành /.
const mountKeep = (path, target) =>
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (_p, req) => req.originalUrl.replace(/^\/api/, '') || '/',
    })
  );

// UC23: xfwd adds x-forwarded-for so Auth sees the client IP of a sign-in (device list, R2/R12).
mount('/api/auth', TARGETS.auth, { xfwd: true });
// UC12: xfwd so Tour rate-limits the automatic translation route per client IP.
mount('/api/tours', TARGETS.tour, { xfwd: true });
// UC07 — lịch trình cá nhân + khám phá địa điểm lẻ (cùng tour service).
mountKeep('/api/itineraries', TARGETS.tour);
mountKeep('/api/places', TARGETS.tour);
mount('/api/moderation', TARGETS.moderation);
// Tải ảnh/audio của tour (Studio) + file tĩnh khi dev.
mount('/api/media', TARGETS.media);
// UC16 — the signed-in user's in-app notifications.
mount('/api/notifications', TARGETS.notification);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log('[gateway] routes: /api/auth /api/tours /api/itineraries /api/places /api/moderation /api/media /api/notifications');
  if (CHATBOT_ENABLED) console.log('[gateway] chatbot: /api/chat /api/chat/history');
});

// Graceful shutdown (#348), inline like the health routes (same behaviour as shared/shutdown):
// SIGTERM / SIGINT -> /readyz 503, wait SHUTDOWN_DELAY_MS (default 0, set it behind a load
// balancer), stop accepting, let requests in flight finish (chat streams get 10 s, then their
// sockets are closed), close Redis, exit 0. A second signal, or more than 28 s, exits 1.
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS) || 0;
function shutdown(signal) {
  if (shuttingDown) {
    console.warn(`[gateway] ${signal} again: exiting now`);
    process.exit(1);
  }
  shuttingDown = true;
  const t0 = Date.now();
  console.log(`[gateway] ${signal}: shutting down`);
  setTimeout(() => {
    console.error('[gateway] shutdown took more than 28000 ms, exiting now');
    process.exit(1);
  }, 28000).unref();
  setTimeout(() => {
    const force = setTimeout(() => server.closeAllConnections(), 10000);
    server.close(async () => {
      clearTimeout(force);
      const redis = getRedis();
      if (redis) {
        const timeout = new Promise((resolve) => setTimeout(resolve, 2000).unref());
        await Promise.race([redis.quit().catch(() => {}), timeout]);
      }
      console.log(`[gateway] shutdown complete (${Date.now() - t0} ms)`);
      process.exit(0);
    });
    server.closeIdleConnections();
  }, SHUTDOWN_DELAY_MS);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
