// Handler for tour.submitted (task #AI-37). Same rules as the place handler.
// The shared consume() acks when the handler returns and nacks WITHOUT requeue when it throws, so this
// handler never throws: retryable work is saved as a case (ai_failed) and retried by the sweeper.
// An invalid payload can never succeed, so it is logged and dropped (acked).
// `validate` is the shared validateEvent, injected (this module does not import shared/).
import { MODERATION_EVENTS } from '../../application/events.js';

export function createTourSubmittedHandler({ runTourReview, validate, logger = console }) {
  if (typeof validate !== 'function') throw new TypeError('tour.submitted handler needs a validate function');
  return async function handleTourSubmitted(eventName, payload) {
    let valid;
    try {
      valid = validate(MODERATION_EVENTS.TOUR_SUBMITTED, payload);
    } catch (err) {
      // Log only ids and the failing paths, never the content.
      const paths = Array.isArray(err?.issues) ? err.issues.map((i) => i.path.join('.')).join(', ') : err?.message;
      logger.warn(`[moderation] dropped invalid ${eventName} tourId=${payload?.tourId ?? '?'}: ${paths}`);
      return;
    }
    try {
      await runTourReview.execute(valid);
    } catch (err) {
      // The use-case already catches its own errors; this is a last guard so the message is not nacked.
      logger.error(`[moderation] tour review crashed tourId=${valid.tourId} revision=${valid.revision}: ${err?.message}`);
    }
  };
}

// Name used by the original stub.
export const makeTourSubmittedHandler = createTourSubmittedHandler;
