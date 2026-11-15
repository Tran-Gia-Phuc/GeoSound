// Event names (routing keys) used by Moderation, same strings as shared/events EVENTS (task #AI-36).
// Kept local because unit-tested modules must not import shared/: in the repo layout (CI) `../shared`
// does not exist; only src/index.js imports shared (it runs in the Docker image).
// test/event-publisher.test.js checks these names against shared/events.
export const MODERATION_EVENTS = Object.freeze({
  PLACE_SUBMITTED: 'place.submitted',
  PLACE_AI_PASSED: 'place.ai_passed',
  PLACE_AI_REJECTED: 'place.ai_rejected',
  TOUR_SUBMITTED: 'tour.submitted',
  TOUR_AI_PASSED: 'tour.ai_passed',
  TOUR_AI_REJECTED: 'tour.ai_rejected',
});
