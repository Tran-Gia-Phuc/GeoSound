// Handler for place.submitted (task #AI-36).
// The shared consume() acks when the handler returns and nacks WITHOUT requeue when it throws, so this
// handler never throws: retryable work is saved as a case (ai_failed) and retried by the sweeper.
// An invalid payload can never succeed, so it is logged and dropped (acked).
// `validate` is the shared validateEvent, injected (this module does not import shared/).
import { MODERATION_EVENTS } from '../../application/events.js';

export function createPlaceSubmittedHandler({ runPlaceReview, validate, logger = console }) {
  if (typeof validate !== 'function') throw new TypeError('place.submitted handler needs a validate function');
  return async function handlePlaceSubmitted(eventName, payload) {
    let valid;
    try {
      valid = validate(MODERATION_EVENTS.PLACE_SUBMITTED, payload);
    } catch (err) {
      // Log only ids and the failing paths, never the content.
      const paths = Array.isArray(err?.issues) ? err.issues.map((i) => i.path.join('.')).join(', ') : err?.message;
      logger.warn(`[moderation] dropped invalid ${eventName} placeId=${payload?.placeId ?? '?'}: ${paths}`);
      return;
    }
    try {
      await runPlaceReview.execute(valid);
    } catch (err) {
      // The use-case already catches its own errors; this is a last guard so the message is not nacked.
      logger.error(`[moderation] place review crashed placeId=${valid.placeId} revision=${valid.revision}: ${err?.message}`);
    }
  };
}

// Name used by the original stub.
export const makePlaceSubmittedHandler = createPlaceSubmittedHandler;
