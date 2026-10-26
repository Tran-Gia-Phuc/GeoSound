// =========================================================
// UC09 — bước 2: danh sách tour của contributor kèm trạng thái + số điểm dừng
// (để Studio hiện tiến độ và bước tiếp theo trên từng thẻ).
// Sắp xếp mới sửa gần nhất lên đầu (do repository đảm nhiệm).
// =========================================================

export class ListMyTours {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository, placeRepo? }} deps */
  constructor({ tourRepo, placeRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
  }

  /** @param {{ authorId: string }} input */
  async execute({ authorId }) {
    const tours = await this.tourRepo.listByAuthor(authorId);
    const stats = this.placeRepo?.statsByTours
      ? await this.placeRepo.statsByTours(tours.map((t) => t.id))
      : new Map();
    // E1 — rỗng thì trả []
    return tours.map((tour) => ({ ...tour.toSummary(), placeCount: stats.get(tour.id)?.count ?? 0 }));
  }
}
