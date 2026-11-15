// =========================================================
// UC17 (#271) — tour statistics for the contributor (docs/02-design/uc17-tour-stats.md).
//   RecordTourActivity : one count per (tour, actor, action, language, UTC day); public tours only
//   GetTourStats       : totals, daily rows, ratings and latest comments (owner or admin)
//   PurgeActivityMarks : delete dedup marks older than 40 days (hourly job)
// The counter and its dedup mark are written in one SQL statement by the repository.
// =========================================================
import {
  ACTIVITY_COUNTERS,
  DAILY_MARK_CAP,
  MARK_RETENTION_DAYS,
  STATS_COMMENTS_TAKE,
  actorKey,
  utcDay,
  addDays,
  resolvePeriod,
  totalsOf,
} from '../../domain/entities/tour-stats.js';
import { ValidationError, TourNotFoundError, NotTourOwnerError } from '../../domain/errors/index.js';

export class RecordTourActivity {
  /** @param {{ tourRepo, statsRepo, salt?: string, now?: () => Date }} deps */
  constructor({ tourRepo, statsRepo, salt, now = () => new Date() }) {
    this.tourRepo = tourRepo;
    this.statsRepo = statsRepo;
    this.salt = salt;
    this.now = now;
  }

  /**
   * @param {{ tourId: string, action: string, language?: string, userId?: string|null, deviceId?: string|null }} input
   * @returns {Promise<{ counted: boolean }>} never reveals whether the tour exists or is public
   */
  async execute({ tourId, action, language, userId, deviceId }) {
    if (!ACTIVITY_COUNTERS[action]) throw new ValidationError('Hành động không hợp lệ', { action: 'Hành động không hợp lệ' });
    const key = actorKey({ userId, deviceId, salt: this.salt });
    if (!key) throw new ValidationError('Thiếu mã thiết bị', { deviceId: 'Thiếu mã thiết bị' });

    const tour = await this.tourRepo.findPublicById(tourId);
    if (!tour) return { counted: false }; // only public tours count; 204 either way

    const counted = await this.statsRepo.recordActivity({
      tourId,
      actorKey: key,
      action,
      language: language || tour.originalLanguage,
      day: utcDay(this.now()),
      cap: DAILY_MARK_CAP,
    });
    return { counted };
  }
}

export class GetTourStats {
  /** @param {{ tourRepo, statsRepo, ratingRepo, now?: () => Date }} deps */
  constructor({ tourRepo, statsRepo, ratingRepo, now = () => new Date() }) {
    this.tourRepo = tourRepo;
    this.statsRepo = statsRepo;
    this.ratingRepo = ratingRepo;
    this.now = now;
  }

  /** @param {{ tourId: string, userId: string, role?: string, from?: string, to?: string, language?: string }} input */
  async execute({ tourId, userId, role, from, to, language }) {
    const period = resolvePeriod({ from, to, now: this.now() });
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (role !== 'admin' && !tour.isOwnedBy(userId)) throw new NotTourOwnerError();

    const lang = language || null;
    const [daily, distribution, comments] = await Promise.all([
      this.statsRepo.dailyStats(tourId, { ...period, language: lang }),
      this.ratingRepo.distribution(tourId),
      this.statsRepo.latestComments(tourId, { take: STATS_COMMENTS_TAKE }),
    ]);
    return {
      tourId,
      from: period.from,
      to: period.to,
      language: lang,
      totals: totalsOf(daily),
      daily,
      // average / count from the tour row (may include seeded demo values, uc05 design 3);
      // the distribution counts the rating rows only.
      ratings: { averageRating: tour.averageRating ?? 0, ratingCount: tour.ratingCount ?? 0, distribution },
      comments,
    };
  }
}

export class PurgeActivityMarks {
  /** @param {{ statsRepo, now?: () => Date }} deps */
  constructor({ statsRepo, now = () => new Date() }) {
    this.statsRepo = statsRepo;
    this.now = now;
  }

  /** @returns {Promise<{ deleted: number }>} */
  async execute() {
    const before = addDays(utcDay(this.now()), -MARK_RETENTION_DAYS);
    return { deleted: await this.statsRepo.purgeMarksBefore(before) };
  }
}
