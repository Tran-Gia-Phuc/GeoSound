// =========================================================
// Composition root (Moderation): the ONLY place that wires the layers (tasks #AI-36, #AI-37).
// Manual DI: infrastructure (port implementations) -> use-cases -> event handlers.
//
//   domain          : case state machine, merge rules, geo rules (pure JS)
//   application     : use-cases (place review, tour review, retry sweeper)
//   infrastructure  : Prisma repository, HTTP AI reviewer, event publisher
//   interfaces      : RabbitMQ event handlers
//
// Prisma, the raw publish() and the shared validateEvent are passed in by index.js, so this module never
// imports shared/ (it does not exist in the repo layout used by CI) and tests can wire it with fakes.
// =========================================================
import { PrismaModerationRepository } from './infrastructure/persistence/prisma-moderation-repository.js';
import { HttpAiReviewer } from './infrastructure/ai/http-ai-reviewer.js';
import { EventPublisher } from './infrastructure/messaging/event-publisher.js';
import { RunPlaceReview } from './application/use-cases/run-place-review.js';
import { RunTourReview } from './application/use-cases/run-tour-review.js';
import { RetryFailedCases } from './application/use-cases/retry-failed-cases.js';
import { createPlaceSubmittedHandler } from './interfaces/events/place-submitted-consumer.js';
import { createTourSubmittedHandler } from './interfaces/events/tour-submitted-consumer.js';

const systemClock = Object.freeze({ now: () => new Date() });

/**
 * @param {{ prisma: object, publish: (eventName: string, payload: object) => Promise<void>,
 *           validateEvent: (eventName: string, payload: object) => object,
 *           config: ReturnType<typeof import('./config.js').loadConfig>, fetchImpl?: typeof fetch,
 *           clock?: { now: () => Date }, logger?: Pick<Console, 'info' | 'warn' | 'error'> }} deps
 */
export function buildContainer({
  prisma, publish, validateEvent, config, fetchImpl = globalThis.fetch, clock = systemClock, logger = console,
}) {
  // --- infrastructure ---
  const repo = new PrismaModerationRepository(prisma);
  const aiReviewer = new HttpAiReviewer({
    baseUrl: config.ai.baseUrl,
    token: config.ai.internalToken,
    timeoutMs: config.ai.timeoutMs,
    maxAttempts: config.ai.maxAttempts,
    retryDelayMs: config.ai.retryDelayMs,
    fetchImpl,
  });
  const publisher = new EventPublisher({ publish, validate: validateEvent });

  // --- application ---
  const runPlaceReview = new RunPlaceReview({ repo, aiReviewer, publisher, clock, logger });
  const runTourReview = new RunTourReview({ repo, aiReviewer, publisher, clock, logger, geoLimits: config.geo });
  // Sweeper use-case (#AI-38); index.js starts its timer.
  const retryFailedCases = new RetryFailedCases({
    repo,
    runPlaceReview,
    runTourReview,
    clock,
    config: {
      failedAfterMs: config.sweep.failedAfterMs,
      staleAfterMs: config.sweep.staleAfterMs ?? config.sweep.failedAfterMs,
      batchSize: config.sweep.batchSize,
    },
    logger,
  });

  // --- interfaces ---
  const handlers = Object.freeze({
    placeSubmitted: createPlaceSubmittedHandler({ runPlaceReview, validate: validateEvent, logger }),
    tourSubmitted: createTourSubmittedHandler({ runTourReview, validate: validateEvent, logger }),
  });

  return { repo, aiReviewer, publisher, runPlaceReview, runTourReview, retryFailedCases, handlers };
}
