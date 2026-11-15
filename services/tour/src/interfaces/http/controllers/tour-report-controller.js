// =========================================================
// TourReportController (UC06, #268) — thin: validated input -> use case -> JSON.
// The reporter comes from the token (req.user.sub); the body never names the user.
// =========================================================

export class TourReportController {
  /** @param {{ reportTour, getMyTourReport }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['report', 'mine']) this[m] = this[m].bind(this);
  }

  async report(req, res) {
    const result = await this.uc.reportTour.execute({
      tourId: req.validatedParams.id,
      reporterId: req.user.sub,
      ...req.validated,
    });
    res.status(201).json(result);
  }

  async mine(req, res) {
    res.json(await this.uc.getMyTourReport.execute({ tourId: req.validatedParams.id, reporterId: req.user.sub }));
  }
}
