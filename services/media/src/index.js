// =========================================================
// Media service (UC09/UC10 tải ảnh & audio; UC12 + TTS của UC03 sau này).
//   - HTTP :3005 — POST /uploads (qua gateway /api/media/uploads), GET /files/*
//     khi lưu ổ đĩa (dev).
//   - Worker RabbitMQ (skeleton) — consume tts.render.requested / tour.approved.
//     Worker lỗi kết nối KHÔNG làm sập phần HTTP (thử lại sau).
// =========================================================
import express from 'express';
import Redis from 'ioredis';
import {
  logger,
  errorHandler,
  setSessionRevocationCheck,
  createRedisRevocationCheck,
} from '../shared/middleware/index.js';
import { connect, consume, publish } from '../shared/rabbitmq/index.js';
import { EVENTS } from '../shared/events/index.js';
import { buildContainer } from './container.js';

// UC23 — reject access tokens of signed-out sessions (key revoked:sid:<sid>, written by Auth).
// No offline queue: while Redis is down the check fails at once and verifyJwt lets the request
// through (fail open) instead of hanging an upload.
const revocationRedis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
let redisErrorLogged = false;
revocationRedis.on('error', (err) => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  console.warn(`[media] Redis unavailable for the session revocation check: ${err.message}`);
});
setSessionRevocationCheck(createRedisRevocationCheck(revocationRedis));

const PORT = process.env.PORT || 3005;
const { mediaRouter, localDir, storageName } = buildContainer(process.env);

const app = express();
app.use(logger);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'media', storage: storageName }));
app.use('/', mediaRouter);
if (localDir) {
  // File tải lên khi dev (LocalDiskStorage) — tên file là UUID, không đổi nội dung.
  app.use(
    '/files',
    express.static(localDir, {
      maxAge: '365d',
      immutable: true,
      fallthrough: false,
      // .webm/.m4a mặc định bị đoán là video — file trong audios/ là audio.
      setHeaders: (res, filePath) => {
        if (!/[\\/]audios[\\/]/.test(filePath)) return;
        if (filePath.endsWith('.webm')) res.setHeader('Content-Type', 'audio/webm');
        else if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
      },
    }),
  );
}
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);
app.listen(PORT, () => console.log(`[media] http :${PORT} (storage: ${storageName})`));

async function startWorker() {
  await connect();
  await consume(
    'media.tts-render',
    [EVENTS.TTS_RENDER_REQUESTED, EVENTS.TOUR_APPROVED],
    async (event, payload) => {
      console.log(`[media] got ${event}:`, payload);
      // TODO(UC12): Google Translate + TTS -> .mp3 -> lưu trữ
      //   rồi publish tts.render.completed với danh sách asset.
      void publish;
    }
  );
  console.log('[media] worker started');
}

function startWorkerWithRetry(delayMs = 10000) {
  startWorker().catch((err) => {
    console.error(`[media] worker: ${err.message} — thử lại sau ${delayMs / 1000}s`);
    setTimeout(() => startWorkerWithRetry(delayMs), delayMs);
  });
}
startWorkerWithRetry();
