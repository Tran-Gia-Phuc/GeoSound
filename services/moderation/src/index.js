// =========================================================
// Moderation service entry point: starts HTTP (/health), the RabbitMQ consumers (tasks #AI-36, #AI-37) and the
// retry sweeper (task #AI-38).
// Wiring lives in container.js; this file only starts things. It is the only module that imports shared/
// (it runs in the Docker image, where shared/ sits next to src/); everything else gets it injected.
// =========================================================
import express from 'express';
import { logger, errorHandler } from '../shared/middleware/index.js';
import { connect, consume, publish } from '../shared/rabbitmq/index.js';
import { EVENTS, validateEvent } from '../shared/events/index.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { startRetrySweeper } from './interfaces/jobs/retry-sweeper.js';

const config = loadConfig();
const app = express();

app.use(express.json());
app.use(logger);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'moderation' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(config.port, () => console.log(`[moderation] listening on :${config.port}`));

(async () => {
  try {
    await connect();
    // Lazy import: the Prisma client is only loaded by the running service, never by tests.
    const { prisma } = await import('./infrastructure/persistence/prisma-client.js');
    const container = buildContainer({ prisma, publish, validateEvent, config });

    // place.submitted -> place review (prefetch limits concurrent AI calls, D13).
    await consume('moderation.place-submitted', [EVENTS.PLACE_SUBMITTED], container.handlers.placeSubmitted,
      { prefetch: config.prefetch });

    // tour.submitted -> geo rules + AI text check (#AI-37). Same queue name as before.
    await consume('moderation.tour-submitted', [EVENTS.TOUR_SUBMITTED], container.handlers.tourSubmitted,
      { prefetch: config.prefetch });

    // Sweeper: retries ai_failed / stale cases, re-publishes unpublished results (#AI-38, D11).
    startRetrySweeper({ retryFailedCases: container.retryFailedCases, intervalMs: config.sweep.intervalMs });
  } catch (err) {
    console.error('[moderation] rabbitmq init failed:', err.message);
  }
})();
