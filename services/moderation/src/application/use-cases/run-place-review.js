// Use-case: place.submitted -> save case -> call AI -> publish place.ai_passed|ai_rejected (task #AI-28).
// Idempotent per (place, revision): a stored result is re-published, AI is not called again (D10).
// AI down after retries: status ai_failed, publish nothing (D11).
export class RunPlaceReview {
  /** @param {{ repo, aiReviewer, publisher, clock }} deps */
  constructor({ repo, aiReviewer, publisher, clock }) {
    Object.assign(this, { repo, aiReviewer, publisher, clock });
  }
  async execute(event) { throw new Error('not implemented: #AI-28'); }
}
