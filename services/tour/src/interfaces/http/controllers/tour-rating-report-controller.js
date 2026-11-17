// =========================================================
// UC05 — Thin HTTP controller for rating abuse reports & admin resolution.
// =========================================================

export class TourRatingReportController {
  /** @param {{ submitRatingReport, listAdminRatingReports, resolveRatingReport }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['submit', 'listAdmin', 'resolve']) this[m] = this[m].bind(this);
  }

  async submit(req, res) {
    const result = await this.uc.submitRatingReport.execute({
      tourId: req.validatedParams.id,
      ratingUserId: req.validatedParams.ratingUserId,
      reporterId: req.user.sub,
      ...req.validated,
    });
    res.status(201).json(result);
  }

  async listAdmin(req, res) {
    res.json(await this.uc.listAdminRatingReports.execute(req.validatedQuery));
  }

  async resolve(req, res) {
    const result = await this.uc.resolveRatingReport.execute({
      reportId: req.validatedParams.reportId,
      adminId: req.user.sub,
      ...req.validated,
    });
    res.json(result);
  }
}
