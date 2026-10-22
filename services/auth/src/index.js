// =========================================================
// Auth service (UC01, UC21) — HTTP entrypoint.
// Ráp router từ composition root (container.js) rồi expose dưới /.
// Qua gateway: /api/auth/* -> ở đây là /* (vd /api/auth/login -> /login).
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';
import { buildContainer } from './container.js';

const app = express();
const PORT = process.env.PORT || 3001;

const { authRouter } = buildContainer(process.env);

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth' }));

// UC01: /register /verify-otp /resend-otp /login /forgot-password /reset-password /refresh
app.use('/', authRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[auth] listening on :${PORT}`));
