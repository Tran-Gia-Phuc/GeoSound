// =========================================================
// UC09 — bước 2: danh sách tour của contributor kèm trạng thái.
// Sắp xếp mới sửa gần nhất lên đầu (do repository đảm nhiệm).
// =========================================================

export class ListMyTours {
  /** @param {{ tourRepo: import('../../domain/ports/index.js').TourRepository }} deps */
  constructor({ tourRepo }) {
    this.tourRepo = tourRepo;
  }

  /** @param {{ authorId: string }} input */
  async execute({ authorId }) {
    const tours = await this.tourRepo.listByAuthor(authorId);
    return tours.map((tour) => tour.toSummary()); // E1 — rỗng thì trả []
  }
}
