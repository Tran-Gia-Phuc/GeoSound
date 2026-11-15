// =========================================================
// UC06 (#268) — report a public tour (docs/02-design/uc06-reports.md).
//   ReportTour      : one report per account (409 on a second one); may flag the tour for UC20
//   GetMyTourReport : the caller's report or null (client "already reported" state)
// The repository locks the tour row, so concurrent reports of one tour cannot both miss the
// threshold. tour.reported is published after the commit; a failed publish is only logged.
// =========================================================
import {
  normalizeReportInput,
  reportWindowStart,
  REPORT_FLAG_THRESHOLD,
} from '../../domain/entities/tour-report.js';
import { TourNotFoundError, OwnTourReportError, AlreadyReportedError } from '../../domain/errors/index.js';

/** R1 — only public tours; anything else looks like a missing tour. */
async function loadPublicTour(tourRepo, tourId) {
  const tour = await tourRepo.findPublicById(tourId);
  if (!tour) throw new TourNotFoundError();
  return tour;
}

export class ReportTour {
  /**
   * @param {{ tourRepo, reportRepo, reportEvents?: import('../../domain/ports/index.js').TourReportEvents|null,
   *           clock?: () => Date, logger?: Pick<Console, 'warn'> }} deps
   */
  constructor({ tourRepo, reportRepo, reportEvents = null, clock = () => new Date(), logger = console }) {
    this.tourRepo = tourRepo;
    this.reportRepo = reportRepo;
    this.reportEvents = reportEvents;
    this.clock = clock;
    this.logger = logger;
  }

  /**
   * @param {{ tourId: string, reporterId: string, reason: string, note?: string|null }} input
   * @returns {Promise<{ report: { id, reason, note, createdAt }, flagged: boolean }>}
   */
  async execute({ tourId, reporterId, reason, note }) {
    const input = normalizeReportInput({ reason, note }); // R3, E2
    const tour = await loadPublicTour(this.tourRepo, tourId);
    if (tour.isOwnedBy(reporterId)) throw new OwnTourReportError(); // R4

    const saved = await this.reportRepo.createReport(
      { tourId, reporterId, ...input },
      { windowStart: reportWindowStart(this.clock()), threshold: REPORT_FLAG_THRESHOLD }, // R5
    );
    if (!saved) throw new AlreadyReportedError(); // R2

    await this.#publish(tour, { count: saved.openReportCount, reason: input.reason, flagged: saved.flagged });
    return { report: saved.report.toCreated(), flagged: saved.flagged };
  }

  // R8 — after the commit; never fails the request (the report and the flag are already saved).
  async #publish(tour, info) {
    if (!this.reportEvents) return;
    try {
      await this.reportEvents.reported(tour, info);
    } catch (err) {
      this.logger.warn(`[tour] tour.reported publish failed (tourId=${tour.id}): ${err?.message ?? err}`);
    }
  }
}

export class GetMyTourReport {
  /** @param {{ tourRepo, reportRepo }} deps */
  constructor({ tourRepo, reportRepo }) {
    this.tourRepo = tourRepo;
    this.reportRepo = reportRepo;
  }

  /** @param {{ tourId: string, reporterId: string }} input */
  async execute({ tourId, reporterId }) {
    await loadPublicTour(this.tourRepo, tourId);
    const report = await this.reportRepo.findByTourAndReporter(tourId, reporterId);
    return { report: report ? report.toMine() : null };
  }
}
