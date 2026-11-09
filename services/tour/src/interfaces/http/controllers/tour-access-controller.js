// =========================================================
// TourAccessController (UC14, #269) — thin: validated input -> use case -> JSON.
// The caller comes from the token (req.user.sub); the passcode is never echoed back.
// =========================================================

export class TourAccessController {
  /** @param {{ getTourAccess, setTourPasscode, disableTourAccess, unlockTour, getMyTourAccess, getRestrictedTour }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['get', 'set', 'disable', 'unlock', 'mine', 'detail', 'package', 'translate']) this[m] = this[m].bind(this);
  }

  // ---- author (owner) ----
  async get(req, res) {
    res.json(await this.uc.getTourAccess.execute({ authorId: req.user.sub, tourId: req.validatedParams.tourId }));
  }

  async set(req, res) {
    res.json(
      await this.uc.setTourPasscode.execute({
        authorId: req.user.sub,
        tourId: req.validatedParams.tourId,
        passcode: req.validated.passcode,
      }),
    );
  }

  async disable(req, res) {
    res.json(await this.uc.disableTourAccess.execute({ authorId: req.user.sub, tourId: req.validatedParams.tourId }));
  }

  // ---- tester (any signed-in account) ----
  async unlock(req, res) {
    res.json(
      await this.uc.unlockTour.execute({
        tourId: req.validatedParams.id,
        userId: req.user.sub,
        passcode: req.validated.passcode,
      }),
    );
  }

  async mine(req, res) {
    res.json(await this.uc.getMyTourAccess.execute({ tourId: req.validatedParams.id, userId: req.user.sub }));
  }

  // UC12 — automatic translation of a restricted tour for an unlocked tester.
  async translate(req, res) {
    const tour = await this.uc.translateTourForVisitor.restrictedTour({
      tourId: req.validatedParams.id,
      userId: req.user.sub,
      lang: req.validatedParams.lang,
    });
    res.json({ tour });
  }

  async detail(req, res) {
    const tour = await this.uc.getRestrictedTour.execute({
      tourId: req.validatedParams.id,
      userId: req.user.sub,
      lang: req.validatedQuery.lang,
    });
    res.json({ tour });
  }

  // L9 — offline package of the restricted tour (same shape as GET /:id/package, plus restricted: true)
  async package(req, res) {
    res.json(
      await this.uc.getRestrictedTourPackage.execute({
        tourId: req.validatedParams.id,
        userId: req.user.sub,
        lang: req.validatedQuery.lang,
      }),
    );
  }
}
