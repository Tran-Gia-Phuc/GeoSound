// =========================================================
// UC21 / UC22 (#275) — RabbitMQ handler for account.moderated (queue tour.admin-log): Auth publishes
// one event per account action and Tour records it in the shared admin log (decision L14).
// The shared consume() nacks WITHOUT requeue when a handler throws, so this handler never throws:
// invalid payloads and errors are logged and the message is acked. A redelivered event adds no row
// (unique source key in the repository).
// `validateEvent` (shared/events) is injected by index.js, so this file never imports ../shared.
// =========================================================

export const ACCOUNT_MODERATED_EVENT = 'account.moderated';
export const ADMIN_LOG_QUEUE = 'tour.admin-log';
export const ADMIN_LOG_BINDINGS = Object.freeze([ACCOUNT_MODERATED_EVENT]);

/**
 * @param {{ recordAccountAction: { execute: Function }, validateEvent: (e: string, p: object) => object, logger? }} deps
 * @returns {(eventName: string, payload: object) => Promise<void>}
 */
export function buildAccountModeratedHandler({ recordAccountAction, validateEvent, logger = console }) {
  if (typeof validateEvent !== 'function') throw new Error('buildAccountModeratedHandler: validateEvent is required');
  return async (eventName, payload) => {
    try {
      if (eventName !== ACCOUNT_MODERATED_EVENT) {
        logger.info?.(`[tour] admin log: ignored event ${eventName}`);
        return;
      }
      const valid = validateEvent(eventName, payload);
      await recordAccountAction.execute(valid);
    } catch (err) {
      logger.error(`[tour] ${eventName} not logged: ${err.message}`);
    }
  };
}
