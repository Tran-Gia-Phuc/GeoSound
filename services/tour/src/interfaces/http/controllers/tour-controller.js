// =========================================================
// TourController (UC09) — mỏng: nhận req.validated, gọi use-case, trả JSON.
// authorId lấy từ JWT (req.user.sub) — verifyJwt gắn sẵn ở router.
// KHÔNG chứa logic nghiệp vụ (nằm ở application).
// =========================================================

export class TourController {
  /** @param {{ createTour, listMyTours, getMyTour, updateTour, deleteTour }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['create', 'listMine', 'getOne', 'update', 'remove']) {
      this[m] = this[m].bind(this);
    }
  }

  // Bước 4–8 — tạo tour (Nháp)
  async create(req, res) {
    const tour = await this.uc.createTour.execute({
      authorId: req.user.sub,
      ...req.validated,
    });
    res.status(201).json({ message: 'Đã tạo tour ở trạng thái Nháp', tour });
  }

  // Bước 2 — danh sách tour của tôi
  async listMine(req, res) {
    const tours = await this.uc.listMyTours.execute({ authorId: req.user.sub });
    res.json({ tours });
  }

  // A1.1 — mở một tour của tôi
  async getOne(req, res) {
    const tour = await this.uc.getMyTour.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.id,
    });
    res.json({ tour });
  }

  // A1 — sửa tour
  async update(req, res) {
    const result = await this.uc.updateTour.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.id,
      patch: req.validated,
    });
    const message = result.requiresResubmit
      ? 'Đã lưu. Tour công khai đã chuyển về Nháp, cần gửi duyệt lại'
      : 'Đã lưu thay đổi';
    res.json({ message, ...result });
  }

  // A2 — xóa tour
  async remove(req, res) {
    const result = await this.uc.deleteTour.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.id,
    });
    res.json({ message: 'Đã xóa tour', ...result });
  }
}
