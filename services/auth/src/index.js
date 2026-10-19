// =========================================================
// Auth service (UC01, UC21).
// Skeleton: express + /health. Routes/controllers thật thêm sau.
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth' }));

// TODO(UC01): POST /register, /verify-otp, /login, /refresh, /logout
//   -> src/routes, src/controllers, src/services, src/repositories

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[auth] listening on :${PORT}`));
