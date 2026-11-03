// =========================================================
// UC05 (#267) — rate a public tour (docs/02-design/uc05-ratings.md).
//   ListTourRatings   : public list + summary (average, count, distribution)
//   GetMyTourRating   : the caller's rating or null
//   SaveMyTourRating  : create, or edit when it exists (R2, A1)
//   DeleteMyTourRating: delete the caller's rating (A1)
// The repository locks the caller's rating row for every write, so concurrent submits of one account
// run one after the other; the only retry is when two first submits race on the unique key.
// =========================================================
import { normalizeRatingInput, reviewerName } from '../../domain/entities/tour-rating.js';
import { TourNotFoundError, RatingNotFoundError, OwnTourRatingError } from '../../domain/errors/index.js';

export const RATINGS_PAGE_DEFAULT = 10;
export const RATINGS_PAGE_MAX = 50;

/** R4 — only public tours; anything else looks like a missing tour. */
async function loadPublicTour(tourRepo, tourId) {
  const tour = await tourRepo.findPublicById(tourId);
  if (!tour) throw new TourNotFoundError();
  return tour;
}

const summaryOf = (tour) => ({ averageRating: tour.averageRating ?? 0, ratingCount: tour.ratingCount ?? 0 });

export class ListTourRatings {
  /** @param {{ tourRepo, ratingRepo }} deps */
  constructor({ tourRepo, ratingRepo }) {
    this.tourRepo = tourRepo;
    this.ratingRepo = ratingRepo;
  }

  /** @param {{ tourId: string, page?: number, limit?: number }} input */
  async execute({ tourId, page = 1, limit = RATINGS_PAGE_DEFAULT }) {
    const tour = await loadPublicTour(this.tourRepo, tourId);
    const take = Math.min(Math.max(1, limit), RATINGS_PAGE_MAX);
    const current = Math.max(1, page);
    const [{ items, total }, distribution] = await Promise.all([
      this.ratingRepo.listByTour(tourId, { skip: (current - 1) * take, take }),
      this.ratingRepo.distribution(tourId),
    ]);
    return {
      summary: { ...summaryOf(tour), distribution },
      items: items.map((r) => r.toPublic()),
      page: current,
      limit: take,
      total,
    };
  }
}

export class GetMyTourRating {
  /** @param {{ tourRepo, ratingRepo }} deps */
  constructor({ tourRepo, ratingRepo }) {
    this.tourRepo = tourRepo;
    this.ratingRepo = ratingRepo;
  }

  /** @param {{ tourId: string, userId: string }} input */
  async execute({ tourId, userId }) {
    await loadPublicTour(this.tourRepo, tourId);
    const rating = await this.ratingRepo.findByTourAndUser(tourId, userId);
    return { rating: rating ? rating.toPublic() : null };
  }
}

export class SaveMyTourRating {
  /** @param {{ tourRepo, ratingRepo }} deps */
  constructor({ tourRepo, ratingRepo }) {
    this.tourRepo = tourRepo;
    this.ratingRepo = ratingRepo;
  }

  /**
   * @param {{ tourId: string, userId: string, userName?: string, stars: number, comment?: string|null }} input
   * @returns {Promise<{ created: boolean, rating: object, summary: { averageRating: number, ratingCount: number } }>}
   */
  async execute({ tourId, userId, userName, stars, comment }) {
    const input = normalizeRatingInput({ stars, comment }); // R3, E2
    const tour = await loadPublicTour(this.tourRepo, tourId);
    if (tour.isOwnedBy(userId)) throw new OwnTourRatingError(); // R5
    const fields = { tourId, userId, userName: reviewerName(userName), ...input }; // R8

    // null = a concurrent first submit of this account created the row: the second try edits it (R2).
    const saved = (await this.ratingRepo.saveForUser(fields)) ?? (await this.ratingRepo.saveForUser(fields));
    if (!saved) throw new Error('rating save conflicted twice');
    return { created: saved.created, rating: saved.rating.toPublic(), summary: saved.summary };
  }
}

export class DeleteMyTourRating {
  /** @param {{ tourRepo, ratingRepo }} deps */
  constructor({ tourRepo, ratingRepo }) {
    this.tourRepo = tourRepo;
    this.ratingRepo = ratingRepo;
  }

  /** @param {{ tourId: string, userId: string }} input @returns {Promise<{ summary }>} */
  async execute({ tourId, userId }) {
    await loadPublicTour(this.tourRepo, tourId);
    const deleted = await this.ratingRepo.deleteForUser(tourId, userId);
    if (!deleted) throw new RatingNotFoundError();
    return deleted;
  }
}
