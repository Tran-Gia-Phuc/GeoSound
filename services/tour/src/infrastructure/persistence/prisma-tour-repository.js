// =========================================================
// Impl của port TourRepository bằng Prisma. Map DB row <-> entity Tour.
// Query không gian (PostGIS) của các UC sau (tìm kiếm, "tour gần tôi") sẽ
// thêm vào đây bằng $queryRaw — không rò ra domain/application.
// =========================================================
import { Tour } from '../../domain/entities/tour.js';
import { ADMIN_TARGET, REVIEW_ADMIN_ACTION } from '../../domain/entities/admin-action.js';

/** @implements {import('../../domain/ports/index.js').TourRepository} */
export class PrismaTourRepository {
  /**
   * @param {import('@prisma/client').PrismaClient} prisma
   * @param {{ actionLog?: import('../../domain/ports/index.js').AdminActionRepository }} [opts]
   *   actionLog: UC22 (#275) — a UC19 decision also appends an admin_actions row (same transaction)
   */
  constructor(prisma, { actionLog = null } = {}) {
    this.prisma = prisma;
    this.actionLog = actionLog;
  }

  /** Prisma row -> entity. */
  static toEntity(row) {
    if (!row) return null;
    return new Tour({
      id: row.id,
      title: row.title,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      originalLanguage: row.originalLanguage,
      type: row.type,
      status: row.status,
      authorId: row.authorId,
      city: row.city,
      duration: row.duration,
      averageRating: row.averageRating,
      ratingCount: row.ratingCount,
      moderationReasons: Array.isArray(row.moderationReasons) ? row.moderationReasons : [],
      moderationRevision: row.moderationRevision ?? null,
      reviewReason: row.reviewReason ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async create(tour) {
    const row = await this.prisma.tour.create({
      data: {
        title: tour.title,
        description: tour.description,
        coverImageUrl: tour.coverImageUrl,
        originalLanguage: tour.originalLanguage,
        type: tour.type,
        status: tour.status,
        authorId: tour.authorId,
        city: tour.city,
        duration: tour.duration,
      },
    });
    return PrismaTourRepository.toEntity(row);
  }

  async findById(id) {
    const row = await this.prisma.tour.findUnique({ where: { id } });
    return PrismaTourRepository.toEntity(row);
  }

  async listByAuthor(authorId) {
    const rows = await this.prisma.tour.findMany({
      where: { authorId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(PrismaTourRepository.toEntity);
  }

  async save(tour) {
    const row = await this.prisma.tour.update({
      where: { id: tour.id },
      data: {
        title: tour.title,
        description: tour.description,
        coverImageUrl: tour.coverImageUrl,
        originalLanguage: tour.originalLanguage,
        type: tour.type,
        status: tour.status,
        city: tour.city,
        duration: tour.duration,
      },
    });
    return PrismaTourRepository.toEntity(row);
  }

  async delete(id) {
    await this.prisma.tour.delete({ where: { id } });
  }

  /**
   * UC15 — writes ONLY the status + moderation columns (save() never touches the moderation ones).
   * undefined = keep, null clears moderationRevision.
   * @param {string} id @param {{ status?, moderationReasons?, moderationRevision? }} fields
   */
  async updateModeration(id, { status, moderationReasons, moderationRevision }) {
    const row = await this.prisma.tour.update({
      where: { id },
      data: { status, moderationReasons, moderationRevision },
    });
    return PrismaTourRepository.toEntity(row);
  }

  /**
   * UC15 — conditional write of an AI result: only while the tour is still 'ai_checking' with the
   * same revision (one atomic UPDATE, no read-then-write race). Returns the number of rows updated.
   * UC22 (#275): `reviewQueuedAt` (set by the use case when the tour enters the review queue) is
   * written in the same UPDATE as the status.
   */
  async applyModerationResultIf(id, revision, { status, moderationReasons, reviewQueuedAt }) {
    const { count } = await this.prisma.tour.updateMany({
      where: { id, status: 'ai_checking', moderationRevision: revision },
      data: { status, moderationReasons, ...(reviewQueuedAt ? { reviewQueuedAt } : {}) },
    });
    return count;
  }

  // ---------- UC19 — admin review ----------

  /** Tours in the given statuses, oldest update first (the use-case puts ai_warning first). */
  async listByStatuses(statuses) {
    const rows = await this.prisma.tour.findMany({
      where: { status: { in: [...statuses] } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(PrismaTourRepository.toEntity);
  }

  /**
   * UC19 — conditional admin decision: one UPDATE ... WHERE id AND status IN fromStatuses, and the
   * log rows in the same transaction (written only when the update won): tour_review_actions (UC19
   * dossier) and, with an actionLog, admin_actions (UC22). Returns rows updated (0 | 1).
   * @param {string} id @param {string[]} fromStatuses
   * @param {{ status: string, reviewReason: string|null }} fields
   * @param {{ adminId: string, action: string, reason: string|null, fromStatus: string }} log
   */
  async applyReviewDecisionIf(id, fromStatuses, { status, reviewReason }, log) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tour.updateMany({
        where: { id, status: { in: [...fromStatuses] } },
        data: { status, reviewReason },
      });
      if (count) {
        await tx.tourReviewAction.create({
          data: {
            tourId: id,
            adminId: log.adminId,
            action: log.action,
            reason: log.reason ?? null,
            fromStatus: log.fromStatus,
          },
        });
        // UC22 (#275) — the shared admin log too. The row lock taken by the UPDATE keeps
        // review_queued_at stable until the commit; it is copied so the average review time never
        // depends on the tour row later.
        if (this.actionLog) {
          const queued = await tx.tour.findUnique({ where: { id }, select: { reviewQueuedAt: true } });
          const data = { fromStatus: log.fromStatus };
          if (queued?.reviewQueuedAt) data.queuedAt = new Date(queued.reviewQueuedAt).toISOString();
          await this.actionLog.append(
            {
              adminId: log.adminId,
              action: REVIEW_ADMIN_ACTION[log.action],
              targetType: ADMIN_TARGET.TOUR,
              targetId: id,
              reason: log.reason ?? null,
              data,
            },
            { tx },
          );
        }
      }
      return count;
    });
  }

  // ---------- UC02 — đọc công khai (chỉ tour status=public) ----------

  /** WHERE lọc tìm kiếm công khai. */
  static publicWhere({ q, city, language, type } = {}) {
    const where = { status: 'public' };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (city) where.city = { equals: city, mode: 'insensitive' };
    if (language) where.originalLanguage = language;
    if (type) where.type = type;
    return where;
  }

  static orderBy(sort) {
    switch (sort) {
      case 'rating':
        return [{ averageRating: 'desc' }, { ratingCount: 'desc' }];
      case 'recent':
        return [{ createdAt: 'desc' }];
      case 'popular':
      default:
        return [{ ratingCount: 'desc' }, { averageRating: 'desc' }, { createdAt: 'desc' }];
    }
  }

  async countPublic(filters) {
    return this.prisma.tour.count({ where: PrismaTourRepository.publicWhere(filters) });
  }

  async searchPublicPage(filters, { skip, take, sort }) {
    const rows = await this.prisma.tour.findMany({
      where: PrismaTourRepository.publicWhere(filters),
      orderBy: PrismaTourRepository.orderBy(sort),
      skip,
      take,
    });
    return rows.map(PrismaTourRepository.toEntity);
  }

  /** Mọi id tour công khai khớp lọc (phục vụ sắp xếp "gần tôi" trong app). */
  async listPublicIds(filters) {
    const rows = await this.prisma.tour.findMany({
      where: PrismaTourRepository.publicWhere(filters),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findManyByIds(ids) {
    if (!ids.length) return [];
    const rows = await this.prisma.tour.findMany({
      where: { id: { in: ids }, status: 'public' },
    });
    return rows.map(PrismaTourRepository.toEntity);
  }

  /** Chi tiết tour công khai (UC02 bước 7) — null nếu không tồn tại/không công khai (E3). */
  async findPublicById(id) {
    const row = await this.prisma.tour.findFirst({ where: { id, status: 'public' } });
    return PrismaTourRepository.toEntity(row);
  }
}
