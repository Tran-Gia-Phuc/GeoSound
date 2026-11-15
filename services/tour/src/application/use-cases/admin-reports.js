// =========================================================
// UC20 (#273) — admin handling of reported tours (docs/02-design/uc20-report-handling.md).
// Admin role only (checked by the router).
//   ListReportQueue    : tours with open reports, R1 order, paged (E1: empty list)
//   GetReportDossier   : tour summary, open reports (with the reporter id: admins only), counts of
//                        closed reports, action history of the tour (admin_actions, newest first)
//   HideReportedTour   : public -> hidden, open reports -> actioned; tour.hidden + catalog tour.unpublished
//   RestoreHiddenTour  : hidden -> public (decision L13); tour.restored + catalog tour.published
//   DismissTourReports : open reports -> dismissed, status unchanged; no event
// Writes are conditional and log one admin_actions row in the same transaction (repository):
// 409 when the state moved (another admin won the race). Events are sent after the commit; a
// publish failure is logged and never fails the request.
// =========================================================
import { ADMIN_ACTION, ADMIN_TARGET, normalizeAdminReason } from '../../domain/entities/admin-action.js';
import {
  canHide,
  canRestore,
  availableReportActions,
  QUEUE_PAGE_DEFAULT,
  QUEUE_PAGE_MAX,
} from '../../domain/tour/report-handling.js';
import {
  TourNotFoundError,
  TourNotHideableError,
  TourNotRestorableError,
  NoOpenReportsError,
} from '../../domain/errors/index.js';
import { notifyTourPublished, notifyTourUnpublished } from './notify-tour-catalog.js';

const RACE_MESSAGE = 'Tour vừa được cập nhật bởi thao tác khác, vui lòng tải lại';

export class ListReportQueue {
  /** @param {{ adminReportRepo }} deps */
  constructor({ adminReportRepo }) {
    this.adminReportRepo = adminReportRepo;
  }

  /** @param {{ page?: number, limit?: number }} [input] */
  async execute({ page = 1, limit = QUEUE_PAGE_DEFAULT } = {}) {
    const take = Math.min(Math.max(1, Math.trunc(limit)), QUEUE_PAGE_MAX);
    const current = Math.max(1, Math.trunc(page));
    const { items, total } = await this.adminReportRepo.listQueue({ skip: (current - 1) * take, take });
    return {
      tours: items.map((t) => ({
        tourId: t.tourId,
        title: t.title,
        status: t.status,
        authorId: t.authorId,
        openReportCount: t.openReportCount,
        flagged: t.flaggedAt !== null && t.flaggedAt !== undefined,
        flaggedAt: t.flaggedAt ?? null,
        lastReportAt: t.lastReportAt ?? null,
        reasons: t.reasons ?? {},
      })),
      page: current,
      limit: take,
      total,
    };
  }
}

export class GetReportDossier {
  /** @param {{ tourRepo, adminReportRepo, adminActionRepo }} deps */
  constructor({ tourRepo, adminReportRepo, adminActionRepo }) {
    this.tourRepo = tourRepo;
    this.adminReportRepo = adminReportRepo;
    this.adminActionRepo = adminActionRepo;
  }

  /** @param {{ tourId: string }} input */
  async execute({ tourId }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    const [state, history] = await Promise.all([
      this.adminReportRepo.getReportState(tour.id),
      this.adminActionRepo.listByTarget(ADMIN_TARGET.TOUR, tour.id),
    ]);
    if (!state) throw new TourNotFoundError(); // deleted between the two reads
    return {
      tour: {
        id: tour.id,
        title: tour.title,
        description: tour.description,
        status: tour.status,
        authorId: tour.authorId,
        city: tour.city,
        averageRating: tour.averageRating,
        ratingCount: tour.ratingCount,
      },
      reports: {
        openReportCount: state.openReportCount,
        flagged: state.flaggedAt !== null && state.flaggedAt !== undefined,
        flaggedAt: state.flaggedAt ?? null,
        open: state.open.map((r) => ({
          id: r.id,
          reporterId: r.reporterId, // admins only (UC06 R7 hides it from the contributor)
          reason: r.reason,
          note: r.note,
          createdAt: r.createdAt,
        })),
        dismissedCount: state.counts.dismissed ?? 0,
        actionedCount: state.counts.actioned ?? 0,
      },
      actions: availableReportActions(tour.status, state.openReportCount),
      history: history.map((h) => h.toPublic()),
    };
  }
}

/** Shared deps and event helper of the three decisions. */
class ReportDecision {
  /**
   * @param {{ tourRepo, adminReportRepo, adminReportEvents?, catalog?, placeRepo?, tourLanguageRepo?,
   *           placeTranslationRepo?, logger? }} deps
   */
  constructor({
    tourRepo,
    adminReportRepo,
    adminReportEvents = null,
    catalog = null,
    placeRepo = null,
    tourLanguageRepo = null,
    placeTranslationRepo = null,
    logger = console,
  }) {
    this.tourRepo = tourRepo;
    this.adminReportRepo = adminReportRepo;
    this.adminReportEvents = adminReportEvents;
    this.catalog = catalog;
    this.placeRepo = placeRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
    this.logger = logger;
  }

  async load(tourId) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    return tour;
  }

  /** Sends one event after the commit; a failure is logged only (the decision is saved). */
  async emit(name, tour, send) {
    if (!this.adminReportEvents) return;
    try {
      await send(this.adminReportEvents);
    } catch (err) {
      this.logger.error(`[tour] ${name} not sent (tourId=${tour.id}): ${err.message}`);
    }
  }
}

export class HideReportedTour extends ReportDecision {
  /** @param {{ tourId: string, adminId: string, reason: string }} input */
  async execute({ tourId, adminId, reason }) {
    const text = normalizeAdminReason(reason, { required: true });
    const tour = await this.load(tourId);
    if (!canHide(tour.status)) throw new TourNotHideableError();

    const result = await this.adminReportRepo.hideIf(tour.id, { adminId, reason: text });
    if (!result) throw new TourNotHideableError(RACE_MESSAGE);

    const saved = (await this.tourRepo.findById(tour.id)) ?? tour;
    await this.emit('tour.hidden', saved, (ev) => ev.hidden(saved, text));
    // #240 — the chatbot index drops the tour (no-op unless CHATBOT_EVENTS_ENABLED; logs failures).
    await notifyTourUnpublished(this, saved, 'hidden');
    return { tour: saved.toPublic(), action: ADMIN_ACTION.HIDE_TOUR, closedReports: result.reportCount };
  }
}

export class RestoreHiddenTour extends ReportDecision {
  /** @param {{ tourId: string, adminId: string, reason?: string|null }} input */
  async execute({ tourId, adminId, reason = null }) {
    const text = normalizeAdminReason(reason);
    const tour = await this.load(tourId);
    if (!canRestore(tour.status)) throw new TourNotRestorableError();

    const result = await this.adminReportRepo.restoreIf(tour.id, { adminId, reason: text });
    if (!result) throw new TourNotRestorableError(RACE_MESSAGE);

    const saved = (await this.tourRepo.findById(tour.id)) ?? tour;
    await this.emit('tour.restored', saved, (ev) => ev.restored(saved, text));
    // Same catalog event as a UC19 approval (places that passed moderation, languages, translations).
    if (this.placeRepo) await notifyTourPublished(this, saved);
    return { tour: saved.toPublic(), action: ADMIN_ACTION.RESTORE_TOUR };
  }
}

export class DismissTourReports extends ReportDecision {
  /** @param {{ tourId: string, adminId: string, reason?: string|null }} input */
  async execute({ tourId, adminId, reason = null }) {
    const text = normalizeAdminReason(reason);
    const tour = await this.load(tourId);
    const result = await this.adminReportRepo.dismissIf(tour.id, { adminId, reason: text });
    if (!result) throw new NoOpenReportsError();
    return {
      tourId: tour.id,
      status: result.status,
      action: ADMIN_ACTION.DISMISS_REPORTS,
      dismissedReports: result.reportCount,
    };
  }
}
