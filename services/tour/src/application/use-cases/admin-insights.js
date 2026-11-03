// =========================================================
// UC22 (#275) — admin dashboard and action log; UC21 (#274) step 2 — violation history of an author
// (docs/02-design/uc22-dashboard-log.md). Admin role only (checked by the router). Read-only, except
// RecordAccountAction, which appends the UC21 account actions published by Auth (account.moderated).
//   GetAdminDashboard   : review queue, average review time, reported tours, top contributors and
//                         log counts of a period (default last 7 days, at most 366; E1: zeros)
//   ListAdminActions    : the append-only log, newest first, filtered and paged
//   GetAdminAction      : one log entry (404 admin_action_not_found)
//   GetUserViolations   : tours by status, hidden / rejected tours, reports on the author's tours and the
//                         latest account actions of one user
//   RecordAccountAction : account.moderated -> warn_user | suspend_user | ban_user | restore_user row,
//                         idempotent (source key); a redelivered event adds nothing
// =========================================================
import { ACCOUNT_ADMIN_ACTION, ADMIN_TARGET } from '../../domain/entities/admin-action.js';
import { TOUR_STATUS } from '../../domain/entities/tour.js';
import { AdminActionNotFoundError } from '../../domain/errors/index.js';
import {
  resolveDashboardPeriod,
  resolveLogPeriod,
  secondsToHours,
  accountActionSourceKey,
  LOG_PAGE_DEFAULT,
  LOG_PAGE_MAX,
  TOP_CONTRIBUTOR_LIMIT,
  VIOLATION_ACTIONS_LIMIT,
  VIOLATION_TOURS_LIMIT,
} from '../../domain/tour/admin-insights.js';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export class GetAdminDashboard {
  /** @param {{ adminInsightRepo, clock? }} deps */
  constructor({ adminInsightRepo, clock = () => new Date() }) {
    this.repo = adminInsightRepo;
    this.clock = clock;
  }

  /** @param {{ from?: string, to?: string }} [input] */
  async execute(input = {}) {
    const period = resolveDashboardPeriod(input, this.clock());
    const [queue, seconds, reportedTours, openReportTours, top, actions] = await Promise.all([
      this.repo.countReviewQueue(),
      this.repo.averageReviewSeconds(period),
      this.repo.countReportedTours(period),
      this.repo.countOpenReportTours(),
      this.repo.topContributors(period, { limit: TOP_CONTRIBUTOR_LIMIT }),
      this.repo.countActionsByType(period),
    ]);
    const pending = queue[TOUR_STATUS.PENDING_REVIEW] ?? 0;
    const warning = queue[TOUR_STATUS.AI_WARNING] ?? 0;
    return {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      pendingReview: { pending_review: pending, ai_warning: warning, total: pending + warning },
      averageReviewHours: secondsToHours(seconds),
      reportedTours,
      openReportTours,
      topContributors: top.map((c) => ({
        authorId: c.authorId,
        publicTours: c.publicTours,
        averageRating: round2(c.averageRating),
      })),
      actionsByType: { ...actions },
    };
  }
}

export class ListAdminActions {
  /** @param {{ adminActionRepo }} deps */
  constructor({ adminActionRepo }) {
    this.adminActionRepo = adminActionRepo;
  }

  /**
   * @param {{ adminId?, action?, targetType?, targetId?, from?: string, to?: string, page?: number, limit?: number }} [input]
   */
  async execute({ adminId, action, targetType, targetId, from, to, page = 1, limit = LOG_PAGE_DEFAULT } = {}) {
    const period = resolveLogPeriod({ from, to });
    const take = Math.min(Math.max(1, Math.trunc(limit)), LOG_PAGE_MAX);
    const current = Math.max(1, Math.trunc(page));
    const { items, total } = await this.adminActionRepo.listRecent({
      skip: (current - 1) * take,
      take,
      adminId,
      action,
      targetType,
      targetId,
      from: period.from,
      to: period.to,
    });
    return { items: items.map((a) => a.toPublic()), page: current, limit: take, total };
  }
}

export class GetAdminAction {
  /** @param {{ adminActionRepo }} deps */
  constructor({ adminActionRepo }) {
    this.adminActionRepo = adminActionRepo;
  }

  /** @param {{ id: string }} input */
  async execute({ id }) {
    const entry = await this.adminActionRepo.findById(id);
    if (!entry) throw new AdminActionNotFoundError();
    return entry.toPublic();
  }
}

export class GetUserViolations {
  /** @param {{ adminInsightRepo, adminActionRepo }} deps */
  constructor({ adminInsightRepo, adminActionRepo }) {
    this.repo = adminInsightRepo;
    this.adminActionRepo = adminActionRepo;
  }

  /**
   * Tour cannot tell whether the account exists (Auth owns it): an unknown user gets zeros (E1).
   * @param {{ userId: string }} input
   */
  async execute({ userId }) {
    const [byStatus, hiddenTours, rejectedTours, reports, accountActions] = await Promise.all([
      this.repo.countToursByStatus(userId),
      this.repo.listHiddenTours(userId, { limit: VIOLATION_TOURS_LIMIT }),
      this.repo.listRejectedTours(userId, { limit: VIOLATION_TOURS_LIMIT }),
      this.repo.countReportsOnAuthorTours(userId),
      this.adminActionRepo.listByTarget(ADMIN_TARGET.USER, userId, { limit: VIOLATION_ACTIONS_LIMIT }),
    ]);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return {
      userId,
      tours: {
        total,
        public: byStatus[TOUR_STATUS.PUBLIC] ?? 0,
        hidden: byStatus[TOUR_STATUS.HIDDEN] ?? 0,
        rejected: byStatus[TOUR_STATUS.REJECTED] ?? 0,
      },
      hiddenTours,
      rejectedTours,
      reports: { open: reports.open ?? 0, dismissed: reports.dismissed ?? 0, actioned: reports.actioned ?? 0 },
      accountActions: accountActions.map((a) => a.toPublic()),
    };
  }
}

export class RecordAccountAction {
  /** @param {{ adminActionRepo, logger? }} deps */
  constructor({ adminActionRepo, logger = console }) {
    this.adminActionRepo = adminActionRepo;
    this.logger = logger;
  }

  /**
   * @param {{ userId, action, reason?, until?, adminId, at }} payload  already validated (account.moderated)
   * @returns {Promise<{ recorded: boolean }>}
   */
  async execute(payload) {
    const action = ACCOUNT_ADMIN_ACTION[payload.action];
    if (!action) throw new Error(`unknown account action ${payload.action}`);
    // Only what the log needs: no email or name (they stay with Auth and Notification).
    const data = payload.until ? { until: payload.until } : {};
    const recorded = await this.adminActionRepo.appendOnce(
      {
        adminId: payload.adminId,
        action,
        targetType: ADMIN_TARGET.USER,
        targetId: payload.userId,
        reason: payload.reason ?? null,
        data,
        createdAt: new Date(payload.at),
      },
      accountActionSourceKey(payload),
    );
    if (!recorded) this.logger.info?.(`[tour] account.moderated already logged (userId=${payload.userId})`);
    return { recorded };
  }
}
