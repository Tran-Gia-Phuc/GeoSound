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
};
const CHATBOT_ENABLED = process.env.CHATBOT_ENABLED === 'true';

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

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
mount('/api/tours', TARGETS.tour);
// UC07 — lịch trình cá nhân + khám phá địa điểm lẻ (cùng tour service).
mountKeep('/api/itineraries', TARGETS.tour);
mountKeep('/api/places', TARGETS.tour);
mount('/api/moderation', TARGETS.moderation);
// Tải ảnh/audio của tour (Studio) + file tĩnh khi dev.
mount('/api/media', TARGETS.media);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log('[gateway] routes: /api/auth /api/tours /api/itineraries /api/places /api/moderation /api/media');
  if (CHATBOT_ENABLED) console.log('[gateway] chatbot: /api/chat /api/chat/history');
});
