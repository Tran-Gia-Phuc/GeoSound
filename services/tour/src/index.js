// =========================================================
// Tour service (UC02,03,07-11,13,17,18). Dùng PostGIS nhiều nhất.
// Skeleton: express + /health. CRUD + query không gian thêm sau.
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tour' }));

// TODO: CRUD tour/điểm/route/vùng kích hoạt; tìm kiếm; "tour gần tôi" (PostGIS);
//       publish event tour.submitted khi contributor gửi duyệt (UC15).

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`[tour] listening on :${PORT}`));
