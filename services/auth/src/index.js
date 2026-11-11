// =========================================================
// Auth service (UC01, UC21, UC23) — HTTP entrypoint.
// Ráp router từ composition root (container.js) rồi expose dưới /.
// Qua gateway: /api/auth/* -> ở đây là /* (vd /api/auth/login -> /login).
// Only this file imports ../shared (CI rule): verifyJwt and publish are injected.
// =========================================================
import express from 'express';
import {
  logger,
  errorHandler,
  verifyJwt,
  setSessionRevocationCheck,
  createRedisRevocationCheck,
} from '../shared/middleware/index.js';
import { connect, publish, isReady as rabbitReady } from '../shared/rabbitmq/index.js';
import { registerHealthRoutes, prismaCheck, redisCheck } from '../shared/health/index.js';
import { buildContainer } from './container.js';

const app = express();
const PORT = process.env.PORT || 3001;
const HOUR_MS = 60 * 60 * 1000;

const { authRouter, internalRouter, prisma, redis, purgeEndedSessions } = buildContainer(process.env, {
  verifyJwt,
  publish,
});

// UC23 / 5.3 — a signed-out session's access token is rejected at once (Redis key revoked:sid:<sid>).
setSessionRevocationCheck(createRedisRevocationCheck(redis));

// UC23 / R10 — the new-device alert (and UC21 account.moderated) goes through RabbitMQ. Sign-in never waits for the broker:
// until it is connected, publish fails and the session manager only logs it. The helper waits for
// the broker (no retry limit) and reconnects after a loss (#345).
connect(undefined, { retries: Infinity, delayMs: 10000 }).catch((err) =>
  console.error(`[auth] RabbitMQ unavailable, new-device alerts disabled: ${err.message}`),
);

// UC23 / R12 — delete sessions that ended more than 30 days ago (at start, then hourly).
const purge = () =>
  purgeEndedSessions
    .execute()
    .then(({ deleted }) => deleted && console.log(`[auth] purged ${deleted} ended sessions`))
    .catch((err) => console.error(`[auth] session purge failed: ${err.message}`));
setTimeout(purge, 60_000).unref();
setInterval(purge, HOUR_MS).unref();

app.use(express.json());
app.use(logger);

// /healthz, /health (liveness) and /readyz (#345): sign-in needs the database and Redis (OTP,
// revocation); RabbitMQ only carries the alerts, so it is reported, not required.
registerHealthRoutes(app, {
  service: 'auth',
  checks: {
    db: { check: prismaCheck(prisma) },
    redis: { check: redisCheck(redis) },
    rabbitmq: { check: rabbitReady, required: false },
  },
});

// UC01: /register /verify-otp /resend-otp /login /forgot-password /reset-password /refresh
// UC23: GET /sessions, DELETE /sessions/:id, POST /sessions/revoke-others, POST /logout
// #265 / #329: POST /sessions/heartbeat, POST /presence, POST /presence/leave, GET /admin/sessions (admin)
// UC21 (admin): GET /admin/users, GET /admin/users/:id, POST /admin/users/:id/{warn,suspend,ban,restore}
app.use('/', authRouter);
// #258: GET /internal/users/:id/contact (x-internal-token; refused when forwarded by the gateway)
app.use('/internal', internalRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[auth] listening on :${PORT}`));
