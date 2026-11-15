// =========================================================
// AdminReportController (UC20, #273) — thin: reads req.validated*, calls the use case, returns JSON.
// adminId comes from the JWT (req.user.sub); the router already checked role = admin.
// =========================================================

export class AdminReportController {
  /** @param {{ listReportQueue, getReportDossier, hideReportedTour, restoreHiddenTour, dismissTourReports }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['queue', 'dossier', 'hide', 'restore', 'dismiss']) {
      this[m] = this[m].bind(this);
    }
  }

  // Steps 1–2 — report queue (E1: empty list)
  async queue(req, res) {
    res.json(await this.uc.listReportQueue.execute(req.validatedQuery ?? {}));
  }

  // Steps 3–4 — reports, tour summary and history of one tour
  async dossier(req, res) {
    res.json(await this.uc.getReportDossier.execute({ tourId: req.validatedParams.tourId }));
  }

  // Steps 5–6 — hide with a reason
  async hide(req, res) {
    const result = await this.uc.hideReportedTour.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
      reason: req.validated.reason,
    });
    res.json({ message: 'Đã ẩn tour và thông báo cho tác giả', ...result });
  }

  // A1 — restore a hidden tour to public
  async restore(req, res) {
    const result = await this.uc.restoreHiddenTour.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
      reason: req.validated.reason,
    });
    res.json({ message: 'Đã khôi phục tour về công khai', ...result });
  }

  // A2 — dismiss the open reports, the tour stays as it is
  async dismiss(req, res) {
    const result = await this.uc.dismissTourReports.execute({
      tourId: req.validatedParams.tourId,
      adminId: req.user.sub,
      reason: req.validated.reason,
    });
    res.json({ message: 'Đã bỏ qua các báo cáo của tour', ...result });
  }
}
