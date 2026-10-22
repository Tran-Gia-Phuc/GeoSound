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
      },
    });
    return PrismaTourRepository.toEntity(row);
  }

  async delete(id) {
    await this.prisma.tour.delete({ where: { id } });
  }
}
