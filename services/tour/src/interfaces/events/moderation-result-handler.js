// =========================================================
// UC15 — RabbitMQ handler for AI moderation results (queue tour.moderation-results).
// The shared consume() nacks WITHOUT requeue when a handler throws, so this handler never throws:
// invalid payloads and errors are logged and the message is acked.
// `validateEvent` (shared/events) is injected by index.js, so this file never imports ../shared.
// =========================================================
import { MODERATION_RESULT_EVENTS } from '../../application/use-cases/apply-moderation-result.js';

export const MODERATION_RESULT_QUEUE = 'tour.moderation-results';
export const MODERATION_RESULT_BINDINGS = Object.freeze(Object.values(MODERATION_RESULT_EVENTS));

/**
 * @param {{ applyModerationResult: { execute: Function }, validateEvent: (e: string, p: object) => object, logger? }} deps
 * @returns {(eventName: string, payload: object) => Promise<void>}
 */
export function buildModerationResultHandler({ applyModerationResult, validateEvent, logger = console }) {
  return async (eventName, payload) => {
    try {
      const valid = validateEvent(eventName, payload);
      await applyModerationResult.execute(eventName, valid);
    } catch (err) {
      logger.error(`[tour] ${eventName} not applied: ${err.message}`);
    }
  };
}
