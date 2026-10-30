// =========================================================
// Entity: TourReviewAction (UC19). One admin decision on a tour, kept as a log for UC22.
// Pure domain: no Prisma / HTTP.
// =========================================================
import { TOUR_STATUS } from './tour.js';

export const REVIEW_ACTION = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
  REQUEST_CHANGES: 'request_changes',
});

// Status the tour gets for each decision.
export const REVIEW_TARGET_STATUS = Object.freeze({
  [REVIEW_ACTION.APPROVE]: TOUR_STATUS.PUBLIC,
  [REVIEW_ACTION.REJECT]: TOUR_STATUS.REJECTED,
  [REVIEW_ACTION.REQUEST_CHANGES]: TOUR_STATUS.CHANGES_REQUESTED,
});

export class TourReviewAction {
  /**
   * @param {{ id?: string, tourId: string, adminId: string, action: string, reason?: string|null,
   *           fromStatus: string, createdAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.tourId = props.tourId;
    this.adminId = props.adminId;
    this.action = props.action;
    this.reason = props.reason ?? null;
    this.fromStatus = props.fromStatus;
    this.createdAt = props.createdAt ?? null;
  }

  toPublic() {
    return {
      id: this.id,
      tourId: this.tourId,
      adminId: this.adminId,
      action: this.action,
      reason: this.reason,
      fromStatus: this.fromStatus,
      createdAt: this.createdAt,
    };
  }
}
