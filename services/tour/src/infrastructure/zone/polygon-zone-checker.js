// =========================================================
// Impl thật của port ForbiddenZoneChecker (UC10 / E2).
// Nạp danh sách vùng cấm đang bật rồi kiểm điểm có rơi vào vùng nào không.
// Vùng cấm: quân sự, trường học, bệnh viện, lãnh sự quán... lưu GeoJSON Polygon.
// =========================================================
import { pointInPolygon } from './point-in-polygon.js';
import { ForbiddenZoneError } from '../../domain/errors/index.js';

/** @implements {import('../../domain/ports/index.js').ForbiddenZoneChecker} */
export class PolygonZoneChecker {
  /** @param {{ zoneRepo: import('../../domain/ports/index.js').ForbiddenZoneRepository }} deps */
  constructor({ zoneRepo }) {
    this.zoneRepo = zoneRepo;
  }

  /** @param {{ lat: number, lng: number }} coords */
  async assertAllowed({ lat, lng }) {
    const zones = await this.zoneRepo.listActive();
    for (const zone of zones) {
      if (zone?.geometry && pointInPolygon([lng, lat], zone.geometry)) {
        throw new ForbiddenZoneError(zone.name); // E2
      }
    }
  }
}
