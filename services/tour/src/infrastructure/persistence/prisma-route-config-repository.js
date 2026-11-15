// =========================================================
// Impl của port RouteConfigRepository bằng Prisma (UC11). Một cấu hình / tour.
// path/triggers/navAudios lưu cột Json (giống images của Place, geometry vùng cấm)
// — đủ cho lưu/đọc cả cụm. Có thể tách cột geometry(LineString/Polygon) + PostGIS
// khi cần truy vấn không gian lúc chạy tour (UC04).
// =========================================================
import { RouteConfig } from '../../domain/entities/route-config.js';

const asArray = (v) => (Array.isArray(v) ? v : []);

/** @implements {import('../../domain/ports/index.js').RouteConfigRepository} */
export class PrismaRouteConfigRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    if (!row) return null;
    return new RouteConfig({
      tourId: row.tourId,
      path: asArray(row.path),
      triggers: asArray(row.triggers),
      navAudios: asArray(row.navAudios),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async findByTour(tourId) {
    const row = await this.prisma.routeConfig.findUnique({ where: { tourId } });
    return PrismaRouteConfigRepository.toEntity(row);
  }

  async upsert(config) {
    const data = {
      path: config.path,
      triggers: config.triggers,
      navAudios: config.navAudios,
    };
    const row = await this.prisma.routeConfig.upsert({
      where: { tourId: config.tourId },
      create: { tourId: config.tourId, ...data },
      update: data,
    });
    return PrismaRouteConfigRepository.toEntity(row);
  }
}
