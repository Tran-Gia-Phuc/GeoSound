// Sweeper use-case: retry ai_failed and stale pending cases (task #AI-29, D11).
// A successful retry publishes exactly once.
export class RetryFailedCases {
  constructor({ repo, runPlaceReview, runTourReview, clock, failedAfterMs }) {
    Object.assign(this, { repo, runPlaceReview, runTourReview, clock, failedAfterMs });
  }
  async execute() { throw new Error('not implemented: #AI-29'); }
}
