// =========================================================
// AdminReviewController (UC19) — thin: reads req.validated*, calls the use-case, returns JSON.
// adminId comes from the JWT (req.user.sub); the router already checked role = admin.
// =========================================================

export class AdminReviewController {
  /** @param {{ listReviewQueue, getReviewDossier, approveTour, rejectTour, requestTourChanges }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['queue', 'dossier', 'approve', 'reject', 'requestChanges']) {
      this[m] = this[m].bind(this);
    }
  }

  // Step 1–2 — review queue (E1: empty list)
  async queue(_req, res) {
    const tours = await this.uc.listReviewQueue.execute();
    res.json({ tours });
  }

  // Step 3–4 — read-only dossier
  async dossier(req, res) {
    const dossier = await this.uc.getReviewDossier.execute({ tourId: req.validatedParams.tourId });
    res.json(dossier);
  }

  // Step 6–8 — approve -> public
  async approve(req, res) {
    const result = await this.uc.approveTour.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
    });
    res.json({ message: 'Đã duyệt tour, tour đã công khai', ...result });
  }

  // A2 — reject with a reason
  async reject(req, res) {
    const result = await this.uc.rejectTour.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
      reason: req.validated.reason,
    });
    res.json({ message: 'Đã từ chối tour', ...result });
  }

  // A3 — request changes with a reason
  async requestChanges(req, res) {
    const result = await this.uc.requestTourChanges.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
      reason: req.validated.reason,
    });
    res.json({ message: 'Đã yêu cầu tác giả chỉnh sửa tour', ...result });
  }
}
