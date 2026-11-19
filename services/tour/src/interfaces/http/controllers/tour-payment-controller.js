// =========================================================
// TourPaymentController (UC25, #446) — thin: validated input -> use case -> JSON.
// =========================================================

export class TourPaymentController {
  /** @param {{ getTourPrice, setTourPrice, startTourPurchase, getMyPurchase, getPaymentStatus, handleMomoIpn, listMyPurchases, listTourSales }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['getPrice', 'setPrice', 'purchase', 'mine', 'status', 'ipn', 'history', 'sales']) this[m] = this[m].bind(this);
  }

  async getPrice(req, res) {
    res.json(await this.uc.getTourPrice.execute({ authorId: req.user.sub, tourId: req.validatedParams.tourId }));
  }

  async setPrice(req, res) {
    res.json(
      await this.uc.setTourPrice.execute({ authorId: req.user.sub, tourId: req.validatedParams.tourId, price: req.validated.price }),
    );
  }

  async sales(req, res) {
    res.json(await this.uc.listTourSales.execute({ authorId: req.user.sub, tourId: req.validatedParams.tourId }));
  }

  async history(req, res) {
    res.json(await this.uc.listMyPurchases.execute({ userId: req.user.sub }));
  }

  async purchase(req, res) {
    res.status(201).json(await this.uc.startTourPurchase.execute({ tourId: req.validatedParams.id, userId: req.user.sub }));
  }

  async mine(req, res) {
    res.json(await this.uc.getMyPurchase.execute({ tourId: req.validatedParams.id, userId: req.user.sub }));
  }

  async status(req, res) {
    res.json(await this.uc.getPaymentStatus.execute({ orderId: req.validatedParams.orderId }));
  }

  // MoMo expects 204 when the notification is accepted.
  async ipn(req, res) {
    await this.uc.handleMomoIpn.execute(req.body ?? {});
    res.status(204).end();
  }
}
