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
}
