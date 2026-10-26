// =========================================================
// UC11 (bước 3–9) — Lưu cấu hình route & kích hoạt cho tour. Chỉ tác giả.
// Gom một lần: route, vùng kích hoạt từng điểm, độ ưu tiên (chồng nhau),
// audio chỉ đường và gợi ý "đi tiếp". Thay thế toàn bộ cấu hình cũ (upsert).
//   - vùng kích hoạt (tròn/đa giác) kiểm hợp lệ qua ActivationZone (E1)
//   - mỗi trigger phải trỏ tới một điểm THUỘC tour, mỗi điểm tối đa một vùng
//   - độ ưu tiên chỉ lưu lại; áp dụng lúc khách đi tour (UC04)
// =========================================================
import { randomUUID } from 'node:crypto';
import { RouteConfig } from '../../domain/entities/route-config.js';
import { ActivationZone } from '../../domain/value-objects/activation-zone.js';
import { Coordinates } from '../../domain/value-objects/coordinates.js';
import {
  TourNotFoundError,
  NotTourOwnerError,
  ValidationError,
} from '../../domain/errors/index.js';

function normalizeHint(hint) {
  if (!hint) return null;
  const text = hint.text?.trim() || null;
  const audioUrl = hint.audioUrl?.trim() || null;
  return text || audioUrl ? { text, audioUrl } : null;
}

export class SaveRouteConfig {
  /** @param {{ tourRepo, placeRepo, routeConfigRepo }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
  }

  /** @param {{ authorId, tourId, path?, triggers?, navAudios? }} input */
  async execute({ authorId, tourId, path, triggers, navAudios }) {
    const tour = await this.tourRepo.findById(tourId);
    if (!tour) throw new TourNotFoundError();
    if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();

    const places = await this.placeRepo.listByTour(tourId);
    const placeIds = new Set(places.map((p) => p.id));

    // Route: chuẩn hóa & kiểm biên từng đỉnh.
    const normalizedPath = (path ?? []).map((pt) => {
      const c = new Coordinates(pt.lat, pt.lng);
      return { lat: c.lat, lng: c.lng };
    });

    // Vùng kích hoạt theo điểm (+ ưu tiên + gợi ý).
    const seen = new Set();
    const normalizedTriggers = (triggers ?? []).map((t) => {
      if (!placeIds.has(t.placeId)) {
        throw new ValidationError('Vùng kích hoạt trỏ tới điểm không thuộc tour');
      }
      if (seen.has(t.placeId)) {
        throw new ValidationError('Mỗi điểm chỉ có một vùng kích hoạt');
      }
      seen.add(t.placeId);
      const zone = new ActivationZone(t.zone); // E1
      return {
        placeId: t.placeId,
        zone: zone.toPublic(),
        priority: t.priority ?? 0,
        nextHint: normalizeHint(t.nextHint),
      };
    });

    // Audio chỉ đường (ngã rẽ) với vùng riêng — A3.
    const normalizedNav = (navAudios ?? []).map((n) => {
      const zone = new ActivationZone(n.zone); // E1
      return {
        id: n.id ?? randomUUID(),
        label: n.label.trim(),
        // Không có file audio → trình phát đọc text (hoặc nhãn) bằng giọng máy.
        audioUrl: n.audioUrl?.trim() || null,
        text: n.text?.trim() || null,
        zone: zone.toPublic(),
      };
    });

    const config = new RouteConfig({
      tourId,
      path: normalizedPath,
      triggers: normalizedTriggers,
      navAudios: normalizedNav,
    });
    const saved = await this.routeConfigRepo.upsert(config);
    return saved.toPublic();
  }
}
