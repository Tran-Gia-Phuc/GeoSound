// =========================================================
// PublicTourController (UC02) — mỏng: tìm kiếm & xem chi tiết tour công khai.
// Không cần đăng nhập. Nhận query đã validate ở req.validatedQuery.
// =========================================================

export class PublicTourController {
  /** @param {{ searchTours }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['search']) this[m] = this[m].bind(this);
  }

  // Bước 1–5 — tìm tour công khai (rỗng = gợi ý phổ biến)
  async search(req, res) {
    const result = await this.uc.searchTours.execute(req.validatedQuery);
    res.json(result);
  }
}
