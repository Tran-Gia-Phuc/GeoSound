// Use-case: tour.submitted -> same flow as RunPlaceReview, using only data inside the event (task #AI-28).
export class RunTourReview {
  constructor({ repo, aiReviewer, publisher, clock }) {
    Object.assign(this, { repo, aiReviewer, publisher, clock });
  }
  async execute(event) { throw new Error('not implemented: #AI-28'); }
}
