// =========================================================
// UC05 (#267) — a rating of a public tour by one account (docs/02-design/uc05-ratings.md).
// Pure: input rules R3 and R8, and the delta that a change brings to the tour aggregate (R7).
// =========================================================
import { ValidationError } from '../errors/index.js';

export const RATING_MIN_STARS = 1;
export const RATING_MAX_STARS = 5;
export const RATING_COMMENT_MAX = 1000;
export const RATING_NAME_MAX = 120;
// R8 — shown when the access token has no `name` claim (tokens issued before #267).
export const DEFAULT_REVIEWER_NAME = 'Người dùng GeoSound';

/** R3 — stars integer 1..5 (E2), comment trimmed, empty -> null, at most 1000 characters. */
export function normalizeRatingInput({ stars, comment } = {}) {
  if (stars === undefined || stars === null || stars === '') throw new ValidationError('Vui lòng chọn số sao', { stars: 'Vui lòng chọn số sao' });
  const n = Number(stars);
  if (!Number.isInteger(n) || n < RATING_MIN_STARS || n > RATING_MAX_STARS) {
    throw new ValidationError('Số sao phải từ 1 đến 5', { stars: 'Số sao phải từ 1 đến 5' });
  }
  let text = comment === undefined || comment === null ? null : String(comment).trim();
  if (text === '') text = null;
  if (text && text.length > RATING_COMMENT_MAX) {
    throw new ValidationError(`Nhận xét tối đa ${RATING_COMMENT_MAX} ký tự`, { comment: `Nhận xét tối đa ${RATING_COMMENT_MAX} ký tự` });
  }
  return { stars: n, comment: text };
}

/** R8 — display name from the token claim, trimmed and bounded; never the email. */
export function reviewerName(name) {
  const text = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  return text ? text.slice(0, RATING_NAME_MAX) : DEFAULT_REVIEWER_NAME;
}

/** R7 — change of (count, star sum) for the tour aggregate. */
export const ratingDelta = {
  created: (stars) => ({ count: 1, sum: stars }),
  updated: (oldStars, newStars) => ({ count: 0, sum: newStars - oldStars }),
  deleted: (stars) => ({ count: -1, sum: -stars }),
};

export class TourRating {
  /**
   * @param {{ id?: string, tourId: string, userId: string, userName: string, stars: number,
   *           comment?: string|null, createdAt?: Date, updatedAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id;
    this.tourId = props.tourId;
    this.userId = props.userId;
    this.userName = props.userName;
    this.stars = props.stars;
    this.comment = props.comment ?? null;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Public view: never the user id (R8). */
  toPublic() {
    return {
      id: this.id,
      userName: this.userName,
      stars: this.stars,
      comment: this.comment,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
