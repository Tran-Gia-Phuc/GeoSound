// =========================================================
// PreviewController (UC13) — mỏng: xem thử tour của chính tác giả.
// authorId lấy từ JWT (req.user.sub); :tourId từ req.validatedParams;
// ?lang= từ req.validatedQuery. KHÔNG chứa logic nghiệp vụ.
// =========================================================

export class PreviewController {
  /** @param {{ previewTour }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    this.preview = this.preview.bind(this);
  }

  // Bước 1–5 — mở chế độ xem thử (?lang= để nghe thử theo ngôn ngữ)
  async preview(req, res) {
    const tour = await this.uc.previewTour.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      lang: req.validatedQuery.lang,
    });
    res.json({ tour });
  }
}
