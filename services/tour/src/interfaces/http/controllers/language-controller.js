// =========================================================
// LanguageController (UC12) — mỏng: nhận req.validated(+Params), gọi use-case.
// authorId từ JWT (req.user.sub); tourId/placeId/lang từ req.validatedParams.
// =========================================================

export class LanguageController {
  /** @param {{ getLanguageConfig, setTourLanguages, previewTts, updateTranslation }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['get', 'set', 'preview', 'updateTranslation']) this[m] = this[m].bind(this);
  }

  // Bước 1–2, 6 — lấy cấu hình ngôn ngữ & giọng
  async get(req, res) {
    const config = await this.uc.getLanguageConfig.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
    });
    res.json({ config });
  }

  // Bước 3–9 — đặt ngôn ngữ phụ + giọng, tự dịch + render TTS
  async set(req, res) {
    const config = await this.uc.setTourLanguages.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      ...req.validated,
    });
    res.json({ message: 'Đã lưu cấu hình ngôn ngữ & giọng đọc', config });
  }

  // A1 — nghe thử TTS một điểm theo ngôn ngữ
  async preview(req, res) {
    const result = await this.uc.previewTts.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      placeId: req.validatedParams.placeId,
      lang: req.validated.lang,
    });
    res.json(result);
  }

  // A2 — chỉnh bản dịch một điểm
  async updateTranslation(req, res) {
    const translation = await this.uc.updateTranslation.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      placeId: req.validatedParams.placeId,
      lang: req.validatedParams.lang,
      text: req.validated.text,
    });
    res.json({ message: 'Đã lưu bản dịch', translation });
  }
}
