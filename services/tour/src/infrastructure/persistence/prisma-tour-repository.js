// =========================================================
// Impl của port TourRepository bằng Prisma. Map DB row <-> entity Tour.
// Query không gian (PostGIS) của các UC sau (tìm kiếm, "tour gần tôi") sẽ
// thêm vào đây bằng $queryRaw — không rò ra domain/application.
// =========================================================
import { Tour } from '../../domain/entities/tour.js';

/** @implements {import('../../domain/ports/index.js').TourRepository} */
export class PrismaTourRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
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
   */
  async applyModerationResultIf(id, revision, { status, moderationReasons }) {
    const { count } = await this.prisma.tour.updateMany({
      where: { id, status: 'ai_checking', moderationRevision: revision },
      data: { status, moderationReasons },
    });
    return count;
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
