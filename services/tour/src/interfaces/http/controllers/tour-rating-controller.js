// =========================================================
// TourRatingController (UC05, #267) — thin: validated input -> use case -> JSON.
// The reviewer comes from the token (req.user: sub, name); the body never names the user.
// =========================================================

export class TourRatingController {
  /** @param {{ listTourRatings, getMyTourRating, saveMyTourRating, deleteMyTourRating }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['list', 'mine', 'save', 'remove']) this[m] = this[m].bind(this);
  }

  async list(req, res) {
    res.json(await this.uc.listTourRatings.execute({ tourId: req.validatedParams.id, ...req.validatedQuery }));
  }

  async mine(req, res) {
    res.json(await this.uc.getMyTourRating.execute({ tourId: req.validatedParams.id, userId: req.user.sub }));
  }

  async save(req, res) {
    const { created, rating, summary } = await this.uc.saveMyTourRating.execute({
      tourId: req.validatedParams.id,
      userId: req.user.sub,
      userName: req.user.name,
      ...req.validated,
    });
    res.status(created ? 201 : 200).json({ rating, summary });
  }

  async remove(req, res) {
    await this.uc.deleteMyTourRating.execute({ tourId: req.validatedParams.id, userId: req.user.sub });
    res.status(204).end();
  }
}
