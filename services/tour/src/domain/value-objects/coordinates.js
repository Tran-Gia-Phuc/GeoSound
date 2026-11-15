// =========================================================
// Value Object: Coordinates (lat/lng của điểm dừng — UC10).
// Kiểm biên hợp lệ. Thuần domain — không phụ thuộc framework/PostGIS.
// =========================================================
import { ValidationError } from '../errors/index.js';

export class Coordinates {
  /** @param {number} lat @param {number} lng */
  constructor(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || la < -90 || la > 90) {
      throw new ValidationError('Vĩ độ (lat) không hợp lệ');
    }
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) {
      throw new ValidationError('Kinh độ (lng) không hợp lệ');
    }
    this.lat = la;
    this.lng = ln;
  }
}
