// =========================================================
// Impl của port PlaceRepository bằng Prisma. Map DB row <-> entity Place.
// Lưu lat/lng dạng Float cho UC10. Cột geometry(Point) + chỉ mục không gian
// (cho "tour gần tôi" / vùng kích hoạt UC11) sẽ thêm bằng migration SQL sau.
// =========================================================
import { Place } from '../../domain/entities/place.js';

/** @implements {import('../../domain/ports/index.js').PlaceRepository} */
export class PrismaPlaceRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    if (!row) return null;
    return new Place({
      id: row.id,
      tourId: row.tourId,
      name: row.name,
      type: row.type,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      sequence: row.sequence,
      images: Array.isArray(row.images) ? row.images : [],
      audioUrl: row.audioUrl,
      audioSource: row.audioSource,
      moderationStatus: row.moderationStatus,
      moderationReasons: Array.isArray(row.moderationReasons) ? row.moderationReasons : [],
      moderationRevision: row.moderationRevision ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toData(place) {
    return {
      name: place.name,
      type: place.type,
      description: place.description,
      lat: place.lat,
      lng: place.lng,
      images: place.images,
      audioUrl: place.audioUrl,
      audioSource: place.audioSource,
    };
  }

  async create(place) {
    const row = await this.prisma.place.create({
      data: {
        tourId: place.tourId,
        sequence: place.sequence,
        moderationStatus: place.moderationStatus,
        ...PrismaPlaceRepository.toData(place),
      },
    });
    return PrismaPlaceRepository.toEntity(row);
  }

  async findById(id) {
    const row = await this.prisma.place.findUnique({ where: { id } });
    return PrismaPlaceRepository.toEntity(row);
  }

  async listByTour(tourId) {
    const rows = await this.prisma.place.findMany({
      where: { tourId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(PrismaPlaceRepository.toEntity);
  }

  async save(place) {
    const row = await this.prisma.place.update({
      where: { id: place.id },
      data: PrismaPlaceRepository.toData(place),
    });
    return PrismaPlaceRepository.toEntity(row);
  }

  async delete(id) {
    await this.prisma.place.delete({ where: { id } });
  }

  /**
   * UC15 — writes ONLY the moderation columns (save() never touches them, so a content edit
   * cannot overwrite a result that just arrived). undefined = keep.
   * @param {string} id @param {{ moderationStatus?, moderationReasons?, moderationRevision? }} fields
   */
  async updateModeration(id, { moderationStatus, moderationReasons, moderationRevision }) {
    const row = await this.prisma.place.update({
      where: { id },
      data: { moderationStatus, moderationReasons, moderationRevision },
    });
    return PrismaPlaceRepository.toEntity(row);
  }

  /**
   * UC15 — conditional write of an AI result: only when the place still has the same revision
   * (one atomic UPDATE, no read-then-write race). Returns the number of rows updated.
   */
  async applyModerationResultIf(id, revision, { moderationStatus, moderationReasons }) {
    const { count } = await this.prisma.place.updateMany({
      where: { id, moderationRevision: revision },
      data: { moderationStatus, moderationReasons },
    });
    return count;
  }

  async nextSequence(tourId) {
    const agg = await this.prisma.place.aggregate({
      where: { tourId },
      _max: { sequence: true },
    });
    return (agg._max.sequence ?? -1) + 1;
  }

  async reorder(tourId, orderedIds) {
    // Đặt sequence = vị trí trong mảng; bọc transaction để nhất quán.
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.place.update({ where: { id }, data: { sequence: index } })
      )
    );
  }

  // ---------- UC02 — thống kê cho thẻ kết quả / sắp xếp gần tôi ----------

  /** Số điểm + số điểm có audio người thật, theo từng tour. */
  async statsByTours(tourIds) {
    const stats = new Map(tourIds.map((id) => [id, { count: 0, humanCount: 0 }]));
    if (!tourIds.length) return stats;

    const [all, human] = await Promise.all([
      this.prisma.place.groupBy({
        by: ['tourId'],
        where: { tourId: { in: tourIds } },
        _count: { _all: true },
      }),
      this.prisma.place.groupBy({
        by: ['tourId'],
        where: { tourId: { in: tourIds }, audioSource: 'human' },
        _count: { _all: true },
      }),
    ]);
    for (const r of all) stats.get(r.tourId).count = r._count._all;
    for (const r of human) stats.get(r.tourId).humanCount = r._count._all;
    return stats;
  }

  /** Tọa độ điểm ĐẦU (sequence nhỏ nhất) của mỗi tour — mốc tính "gần tôi". */
  async anchorsByTours(tourIds) {
    const anchors = new Map();
    if (!tourIds.length) return anchors;
    const rows = await this.prisma.place.findMany({
      where: { tourId: { in: tourIds } },
      orderBy: { sequence: 'asc' },
      select: { tourId: true, lat: true, lng: true },
    });
    for (const r of rows) {
      if (!anchors.has(r.tourId)) anchors.set(r.tourId, { lat: r.lat, lng: r.lng });
    }
    return anchors;
  }

  // ---------- UC07 — khám phá địa điểm lẻ (chỉ tour công khai) ----------

  /** Dựng where: điểm thuộc tour public + lọc q/city/type. */
  static publicPlaceWhere({ q, city, type } = {}) {
    const where = { tour: { is: { status: 'public' } } };
    if (type) where.type = type;
    if (city) where.tour.is.city = { equals: city, mode: 'insensitive' };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async countPublicPlaces(filters) {
    return this.prisma.place.count({ where: PrismaPlaceRepository.publicPlaceWhere(filters) });
  }

  async searchPublicPlaces(filters, { skip, take }) {
    const rows = await this.prisma.place.findMany({
      where: PrismaPlaceRepository.publicPlaceWhere(filters),
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        tourId: true,
        name: true,
        type: true,
        lat: true,
        lng: true,
        images: true,
        description: true,
        audioUrl: true,
        audioSource: true,
        tour: { select: { title: true, city: true, originalLanguage: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      tourId: r.tourId,
      name: r.name,
      type: r.type,
      lat: r.lat,
      lng: r.lng,
      images: Array.isArray(r.images) ? r.images : [],
      description: r.description,
      audioUrl: r.audioUrl,
      audioSource: r.audioSource,
      tourTitle: r.tour?.title ?? null,
      city: r.tour?.city ?? null,
      language: r.tour?.originalLanguage ?? null,
    }));
  }
}
