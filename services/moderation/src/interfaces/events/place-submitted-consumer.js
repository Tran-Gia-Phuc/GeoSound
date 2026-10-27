// Handler for place.submitted (task #AI-28).
// Rule: ack after the case is saved. Never throw for work we want to retry
// (shared consume() nacks without requeue on throw).
export function makePlaceSubmittedHandler({ runPlaceReview, logger = console }) {
  return async function handle(eventName, payload) { throw new Error('not implemented: #AI-28'); };
}
