// =========================================================
// TourStatsController (UC17, #271) — thin: validated input -> use case -> JSON.
// The actor of an activity is the token's account when present, else the body's deviceId.
// =========================================================

export class TourStatsController {
  /** @param {{ recordTourActivity, getTourStats }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['record', 'stats']) this[m] = this[m].bind(this);
  }

  async record(req, res) {
    const { action, language, deviceId } = req.validated;
    await this.uc.recordTourActivity.execute({
      tourId: req.validatedParams.id,
      action,
      language,
      userId: req.user?.sub ?? null,
      deviceId: deviceId ?? null,
    });
    res.status(204).end(); // same answer whether it counted or not
  }

  async stats(req, res) {
    res.json(
      await this.uc.getTourStats.execute({
        tourId: req.validatedParams.id,
        userId: req.user.sub,
        role: req.user.role,
        ...req.validatedQuery,
      }),
    );
  }
}
