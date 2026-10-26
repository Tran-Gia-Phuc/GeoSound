// =========================================================
// UC02 (bước 1–5, A1) — Tìm tour CÔNG KHAI (đã duyệt). Không cần đăng nhập.
// Lọc: từ khóa (tên/mô tả), thành phố, ngôn ngữ gốc, loại tour.
// Sắp xếp: popular | rating | recent | nearby (gần tôi — haversine).
// Mỗi kết quả kèm số điểm, nhãn giọng (ưu tiên người thật), điểm đánh giá và
// toạ độ điểm đầu (anchor) để client hiện tour trên bản đồ Khám phá.
// =========================================================
import { voiceLabelFor } from '../../domain/value-objects/voice.js';
import { haversineMeters } from '../../domain/geo/distance.js';

export class SearchTours {
  /** @param {{ tourRepo, placeRepo }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ q?, city?, language?, type?, sort, lat?, lng?, page, limit }} input */
  async execute(input) {
    const { sort, page, limit, lat, lng, ...filters } = input;
    const skip = (page - 1) * limit;

    const result =
      sort === 'nearby'
        ? await this.#nearby(filters, { lat, lng }, skip, limit)
        : await this.#byColumn(filters, sort, skip, limit);

    return { tours: result.cards, total: result.total, page, limit, sort };
  }

  // Sắp xếp theo cột DB (popular/rating/recent) — phân trang ở DB.
  async #byColumn(filters, sort, skip, limit) {
    const [total, tours] = await Promise.all([
      this.tourRepo.countPublic(filters),
      this.tourRepo.searchPublicPage(filters, { skip, take: limit, sort }),
    ]);
    const ids = tours.map((t) => t.id);
    const [stats, anchors] = await Promise.all([
      this.placeRepo.statsByTours(ids),
      this.placeRepo.anchorsByTours ? this.placeRepo.anchorsByTours(ids) : new Map(),
    ]);
    return { total, cards: tours.map((t) => buildCard(t, stats, undefined, anchors.get(t.id))) };
  }

  // "Gần tôi": xếp theo khoảng cách tới điểm đầu của tour, rồi phân trang trong app.
  async #nearby(filters, me, skip, limit) {
    const ids = await this.tourRepo.listPublicIds(filters);
    const anchors = await this.placeRepo.anchorsByTours(ids);

    const ranked = ids
      .map((id) => {
        const a = anchors.get(id);
        return a ? { id, dist: haversineMeters(me, a) } : null;
      })
      .filter(Boolean)
      .sort((x, y) => x.dist - y.dist);

    const pageSlice = ranked.slice(skip, skip + limit);
    const pageIds = pageSlice.map((r) => r.id);
    const tours = await this.tourRepo.findManyByIds(pageIds);
    const tourMap = new Map(tours.map((t) => [t.id, t]));
    const stats = await this.placeRepo.statsByTours(pageIds);

    const cards = pageSlice
      .map((r) => {
        const tour = tourMap.get(r.id);
        return tour ? buildCard(tour, stats, r.dist, anchors.get(r.id)) : null;
      })
      .filter(Boolean);
    return { total: ranked.length, cards };
  }
}

// Thẻ kết quả tìm kiếm (bước 5).
function buildCard(tour, stats, distanceMeters, anchor) {
  const s = stats.get(tour.id) ?? { count: 0, humanCount: 0 };
  const card = {
    id: tour.id,
    title: tour.title,
    coverImageUrl: tour.coverImageUrl,
    city: tour.city,
    type: tour.type,
    originalLanguage: tour.originalLanguage,
    duration: tour.duration,
    averageRating: tour.averageRating,
    ratingCount: tour.ratingCount,
    placeCount: s.count,
    voiceLabel: voiceLabelFor({ hasHumanAudio: s.humanCount > 0 }),
  };
  if (distanceMeters != null) card.distanceMeters = Math.round(distanceMeters);
  if (anchor) card.anchor = { lat: anchor.lat, lng: anchor.lng };
  return card;
}
