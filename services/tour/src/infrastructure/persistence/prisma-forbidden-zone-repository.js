// =========================================================
// Impl của port ForbiddenZoneRepository bằng Prisma.
// Trả vùng cấm đang bật; geometry là GeoJSON Polygon (cột Json).
// =========================================================

/** @implements {import('../../domain/ports/index.js').ForbiddenZoneRepository} */
export class PrismaForbiddenZoneRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  async listActive() {
    const rows = await this.prisma.forbiddenZone.findMany({ where: { active: true } });
    return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, geometry: r.geometry }));
  }
}
