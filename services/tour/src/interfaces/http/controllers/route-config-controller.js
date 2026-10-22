// =========================================================
// RouteConfigController (UC11) — mỏng: nhận req.validated(+Params), gọi use-case,
// trả JSON. authorId từ JWT (req.user.sub); tourId từ req.validatedParams.
// =========================================================

export class RouteConfigController {
  /** @param {{ getRouteConfig, saveRouteConfig }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['get', 'save']) this[m] = this[m].bind(this);
  }

  // Bước 1–2 — mở tab, lấy cấu hình hiện có
  async get(req, res) {
    const config = await this.uc.getRouteConfig.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
    });
    res.json({ config });
  }

  // Bước 8–9 — lưu toàn bộ cấu hình route & kích hoạt
  async save(req, res) {
    const config = await this.uc.saveRouteConfig.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      ...req.validated,
    });
    res.json({ message: 'Đã lưu cấu hình route & kích hoạt', config });
  }
}
