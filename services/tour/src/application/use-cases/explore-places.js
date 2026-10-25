// UC07 bước 1-2 / A1 — "Khám phá địa điểm": tìm/lọc các địa điểm LẺ thuộc tour
// CÔNG KHAI để thêm vào lịch trình. Lọc theo từ khoá/thành phố/loại; nếu có
// toạ độ người dùng thì sắp theo khoảng cách (gần nhất trước).
// E1 (không có kết quả) → trả rỗng; client gợi ý địa điểm gần/phổ biến.
import { haversineMeters } from '../../domain/geo/distance.js';

export class ExplorePlaces {
  /** @param {{ placeRepo }} deps */
  constructor({ placeRepo }) {
    this.placeRepo = placeRepo;
  }

  /**
   * @param {{ q?: string, city?: string, type?: string, lat?: number, lng?: number,
   *           page?: number, pageSize?: number }} input
   */
  async execute({ q, city, type, lat, lng, page = 1, pageSize = 20 }) {
    const filters = { q, city, type };
    const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    const skip = (page - 1) * pageSize;

    const [total, rows] = await Promise.all([
      this.placeRepo.countPublicPlaces(filters),
      this.placeRepo.searchPublicPlaces(filters, { skip, take: pageSize }),
    ]);

    let items = rows.map((r) => ({
      placeId: r.id,
      tourId: r.tourId,
      name: r.name,
      type: r.type,
      lat: r.lat,
      lng: r.lng,
      images: Array.isArray(r.images) ? r.images : [],
      hasHumanAudio: r.audioSource === 'human',
      tourTitle: r.tourTitle,
      city: r.city ?? null,
    }));

    if (near) {
      items = items
        .map((it) => ({ ...it, distanceMeters: Math.round(haversineMeters(near, it)) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    return { items, total, page, pageSize };
  }
}
