// =========================================================
// Value Object: ActivationZone (vùng kích hoạt audio — UC11).
// Hai dạng do tác giả tự đặt:
//   - tròn   : { shape:'circle',  center:{lat,lng}, radiusMeters }  (chỉnh bán kính)
//   - đa giác: { shape:'polygon', geometry: GeoJSON Polygon }        (chỉnh các đỉnh)
// Kiểm hợp lệ E1: bán kính phải > 0; đa giác phải KHÉP KÍN (>= 3 đỉnh).
// Thuần domain — không phụ thuộc framework/PostGIS. Tọa độ polygon theo
// quy ước GeoJSON [lng, lat] (khớp point-in-polygon.js của vùng cấm).
// =========================================================
import { ValidationError } from '../errors/index.js';
import { Coordinates } from './coordinates.js';

export const ZONE_SHAPE = Object.freeze({ CIRCLE: 'circle', POLYGON: 'polygon' });

// E1 — đa giác chưa khép kín / chưa đủ đỉnh.
function assertValidPolygon(geometry) {
  const rings = geometry?.coordinates;
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(rings) || rings.length === 0) {
    throw new ValidationError('Đa giác vùng kích hoạt không hợp lệ');
  }
  const ring = rings[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new ValidationError('Đa giác chưa khép kín (cần ít nhất 3 đỉnh)');
  }
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) {
    throw new ValidationError('Đa giác chưa khép kín');
  }
  // Đỉnh phân biệt (bỏ điểm đóng vòng ở cuối) phải >= 3.
  const distinct = new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`));
  if (distinct.size < 3) {
    throw new ValidationError('Đa giác chưa khép kín (cần ít nhất 3 đỉnh)');
  }
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new ValidationError('Tọa độ đỉnh đa giác không hợp lệ');
    }
    const [x, y] = pt;
    if (!Number.isFinite(x) || x < -180 || x > 180 || !Number.isFinite(y) || y < -90 || y > 90) {
      throw new ValidationError('Tọa độ đỉnh đa giác không hợp lệ');
    }
  }
}

export class ActivationZone {
  /**
   * @param {{ shape: string, center?: {lat:number,lng:number}, radiusMeters?: number,
   *           geometry?: { type:string, coordinates:number[][][] } }} props
   */
  constructor(props) {
    const shape = props?.shape;
    if (shape === ZONE_SHAPE.CIRCLE) {
      const c = new Coordinates(props.center?.lat, props.center?.lng); // kiểm biên tọa độ
      const r = Number(props.radiusMeters);
      if (!Number.isFinite(r) || r <= 0) {
        throw new ValidationError('Bán kính vùng kích hoạt phải lớn hơn 0'); // E1
      }
      this.shape = ZONE_SHAPE.CIRCLE;
      this.center = { lat: c.lat, lng: c.lng };
      this.radiusMeters = r;
      this.geometry = null;
    } else if (shape === ZONE_SHAPE.POLYGON) {
      assertValidPolygon(props.geometry); // E1
      this.shape = ZONE_SHAPE.POLYGON;
      this.center = null;
      this.radiusMeters = null;
      this.geometry = props.geometry;
    } else {
      throw new ValidationError('Loại vùng kích hoạt không hợp lệ (tròn hoặc đa giác)');
    }
  }

  /** Dạng chuẩn hóa để lưu (JSON) và trả về client. */
  toPublic() {
    return this.shape === ZONE_SHAPE.CIRCLE
      ? { shape: this.shape, center: this.center, radiusMeters: this.radiusMeters }
      : { shape: this.shape, geometry: this.geometry };
  }
}
