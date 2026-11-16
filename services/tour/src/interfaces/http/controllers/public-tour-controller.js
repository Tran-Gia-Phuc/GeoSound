// =========================================================
// PublicTourController (UC02) — mỏng: tìm kiếm & xem chi tiết tour công khai.
// Không cần đăng nhập. Nhận query đã validate ở req.validatedQuery.
// =========================================================

export class PublicTourController {
  /**
   * @param {{ searchTours, getPublicTour, getTourPackage?, translateTourForVisitor? }} useCases
   * @param {{ supportedLanguages?: readonly string[] }} [opts] listening languages (UC12, #425)
   */
  constructor(useCases, { supportedLanguages = [] } = {}) {
    this.uc = useCases;
    this.supportedLanguages = supportedLanguages;
    for (const m of ['search', 'detail', 'package', 'translate', 'languages']) this[m] = this[m].bind(this);
  }

  // UC12 (#425) — the listening languages of this deployment (SUPPORTED_LANGUAGES), for the client.
  languages(_req, res) {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ languages: this.supportedLanguages });
  }

  // Bước 1–5 — tìm tour công khai (rỗng = gợi ý phổ biến)
  async search(req, res) {
    const result = await this.uc.searchTours.execute(req.validatedQuery);
    res.json(result);
  }

  // Bước 6–9 — chi tiết tour công khai (?lang= để đổi ngôn ngữ nghe)
  async detail(req, res) {
    const tour = await this.uc.getPublicTour.execute({
      id: req.validatedParams.id,
      lang: req.validatedQuery.lang,
    });
    res.json({ tour });
  }

  // UC04 / UC12 — automatic translation asked by a tourist -> detail in that language
  async translate(req, res) {
    const tour = await this.uc.translateTourForVisitor.publicTour({
      id: req.validatedParams.id,
      lang: req.validatedParams.lang,
    });
    res.json({ tour });
  }

  // UC03 (#103) — offline package manifest (?lang= = the language to download)
  async package(req, res) {
    const pkg = await this.uc.getTourPackage.execute({
      id: req.validatedParams.id,
      lang: req.validatedQuery.lang,
    });
    res.json(pkg);
  }
}
