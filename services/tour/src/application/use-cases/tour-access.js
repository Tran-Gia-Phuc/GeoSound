// =========================================================
// UC14 (#269) — restricted access with a passcode (docs/02-design/uc14-restricted-access.md).
//   Author (owner only):
//     GetTourAccess       : { restricted, passcodeSetAt, testers }
//     SetTourPasscode     : turn restricted mode on (draft / rejected / changes_requested) or change
//                           the passcode (A1); every older unlock stops working
//     DisableTourAccess   : restricted -> draft (A1), hash and unlocks cleared
//   Tester (any signed-in account):
//     UnlockTour          : passcode -> grant kept per account (rate limited, 429)
//     GetMyTourAccess     : { unlocked }
//     GetRestrictedTour   : the same detail view as the public one, for the owner or an unlocked tester
// A restricted tour is never public: no admin review, no tour.published, never in search / nearby /
// ratings / reports. Anything that is not a restricted tour (or not unlocked) answers 404.
// =========================================================
import { TOUR_STATUS, RESTRICTABLE_STATUSES } from '../../domain/entities/tour.js';
import {
  normalizePasscode,
  unlockWindowStart,
  isGrantValid,
  UNLOCK_MAX_FAILURES,
} from '../../domain/tour/restricted-access.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  TourNotRestrictableError,
  TourNotRestrictedError,
  WrongPasscodeError,
  TooManyAttemptsError,
} from '../../domain/errors/index.js';
import { buildTourDetailView } from './build-tour-detail.js';

const NOT_AVAILABLE = 'Tour không tồn tại hoặc không ở chế độ truy cập hạn chế';

async function loadOwned(tourRepo, { authorId, tourId }) {
  const tour = await tourRepo.findById(tourId);
  if (!tour) throw new TourNotFoundError();
  if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
  return tour;
}

/** Restricted tour or 404 (unknown and non-restricted tours look the same to a tester). */
async function loadRestrictedAccess(accessRepo, tourId) {
  const access = await accessRepo.findAccess(tourId);
  if (!access || access.status !== TOUR_STATUS.RESTRICTED) throw new TourNotFoundError(NOT_AVAILABLE);
  return access;
}

async function hasAccess(accessRepo, access, userId) {
  if (access.authorId === userId) return true;
  return isGrantValid(await accessRepo.findGrant(access.tourId, userId), access.passcodeVersion);
}

const accessView = async (accessRepo, tour) => ({
  restricted: tour.isRestricted(),
  passcodeSetAt: tour.isRestricted() ? tour.passcodeSetAt : null,
  testers: tour.isRestricted() ? await accessRepo.countGrants(tour.id, tour.passcodeVersion) : 0,
});

export class GetTourAccess {
  /** @param {{ tourRepo, accessRepo }} deps */
  constructor({ tourRepo, accessRepo }) {
    this.tourRepo = tourRepo;
    this.accessRepo = accessRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    return accessView(this.accessRepo, tour);
  }
}

export class SetTourPasscode {
  /** @param {{ tourRepo, accessRepo, hasher, clock? }} deps */
  constructor({ tourRepo, accessRepo, hasher, clock = () => new Date() }) {
    this.tourRepo = tourRepo;
    this.accessRepo = accessRepo;
    this.hasher = hasher;
    this.clock = clock;
  }

  /** @param {{ authorId: string, tourId: string, passcode: string }} input */
  async execute({ authorId, tourId, passcode }) {
    const tour = await loadOwned(this.tourRepo, { authorId, tourId });
    const plain = normalizePasscode(passcode); // E1
    const changing = tour.isRestricted();
    if (!changing && !tour.canRestrict()) throw new TourNotRestrictableError();

    const passcodeHash = await this.hasher.hash(plain);
    const fromStatuses = changing ? [TOUR_STATUS.RESTRICTED] : RESTRICTABLE_STATUSES;
    const saved = await this.accessRepo.setPasscodeIf(tourId, fromStatuses, {
      passcodeHash,
      passcodeSetAt: this.clock(),
    });
    if (!saved) throw new TourNotRestrictableError(); // the status moved meanwhile
    return { ...(await accessView(this.accessRepo, saved)), changed: changing ? 'passcode' : 'enabled' };
  }
}

export class DisableTourAccess {
  /** @param {{ tourRepo, accessRepo }} deps */
  constructor({ tourRepo, accessRepo }) {
    this.tourRepo = tourRepo;
    this.accessRepo = accessRepo;
  }

  /** @param {{ authorId: string, tourId: string }} input */
  async execute(input) {
    const tour = await loadOwned(this.tourRepo, input);
    if (!tour.isRestricted()) throw new TourNotRestrictedError();
    const saved = await this.accessRepo.clearPasscodeIf(tour.id);
    if (!saved) throw new TourNotRestrictedError();
    return { tour: saved.toPublic() };
  }
}

export class UnlockTour {
  /** @param {{ accessRepo, hasher, clock? }} deps */
  constructor({ accessRepo, hasher, clock = () => new Date() }) {
    this.accessRepo = accessRepo;
    this.hasher = hasher;
    this.clock = clock;
  }

  /** @param {{ tourId: string, userId: string, passcode: string }} input */
  async execute({ tourId, userId, passcode }) {
    const access = await loadRestrictedAccess(this.accessRepo, tourId);
    const attempt = await this.accessRepo.reserveAttempt(tourId, userId, unlockWindowStart(this.clock()));
    if (attempt.count > UNLOCK_MAX_FAILURES) {
      await this.accessRepo.releaseAttempt(attempt.id); // a refused request does not extend the lock
      throw new TooManyAttemptsError();
    }
    const ok = await this.hasher.verify(String(passcode ?? '').trim(), access.passcodeHash);
    if (!ok) throw new WrongPasscodeError(); // the attempt row stays: one failure
    await this.accessRepo.releaseAttempt(attempt.id);
    await this.accessRepo.saveGrant(tourId, userId, access.passcodeVersion);
    return { unlocked: true };
  }
}

export class GetMyTourAccess {
  /** @param {{ accessRepo }} deps */
  constructor({ accessRepo }) {
    this.accessRepo = accessRepo;
  }

  /** @param {{ tourId: string, userId: string }} input */
  async execute({ tourId, userId }) {
    const access = await loadRestrictedAccess(this.accessRepo, tourId);
    return { unlocked: await hasAccess(this.accessRepo, access, userId) };
  }
}

export class GetRestrictedTour {
  /** @param {{ tourRepo, accessRepo, placeRepo, routeConfigRepo, tourLanguageRepo?, placeTranslationRepo? }} deps */
  constructor({ tourRepo, accessRepo, placeRepo, routeConfigRepo, tourLanguageRepo = null, placeTranslationRepo = null }) {
    this.tourRepo = tourRepo;
    this.accessRepo = accessRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ tourId: string, userId: string, lang?: string }} input */
  async execute({ tourId, userId, lang }) {
    const access = await loadRestrictedAccess(this.accessRepo, tourId);
    if (!(await hasAccess(this.accessRepo, access, userId))) throw new TourNotFoundError(NOT_AVAILABLE);
    const tour = await this.tourRepo.findById(tourId);
    if (!tour || !tour.isRestricted()) throw new TourNotFoundError(NOT_AVAILABLE);

    const [places, routeCfg, langs, translations] = await Promise.all([
      this.placeRepo.listByTour(tourId),
      this.routeConfigRepo.findByTour(tourId),
      this.tourLanguageRepo?.listByTour(tourId) ?? [],
      this.placeTranslationRepo?.listByTour(tourId) ?? [],
    ]);
    const view = buildTourDetailView({ tour, places, route: routeCfg, langs, translations, lang });
    return { ...view, restricted: true };
  }
}
