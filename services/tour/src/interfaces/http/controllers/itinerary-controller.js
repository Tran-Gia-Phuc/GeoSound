// =========================================================
// ItineraryController (UC07) — mỏng: lấy ownerId từ JWT (req.user.sub), gọi
// use-case, trả JSON. Không chứa logic nghiệp vụ.
// =========================================================
export class ItineraryController {
  /** @param {{ createItinerary, listMyItineraries, getItinerary, renameItinerary,
   *            deleteItinerary, addItineraryItem, removeItineraryItem,
   *            reorderItineraryItems, shareItinerary }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of [
      'create', 'listMine', 'getOne', 'rename', 'remove',
      'addItem', 'removeItem', 'reorder', 'share',
    ]) {
      this[m] = this[m].bind(this);
    }
  }

  #owner(req) {
    return req.user.sub;
  }

  async create(req, res) {
    const data = await this.uc.createItinerary.execute({ ownerId: this.#owner(req), name: req.validated.name });
    res.status(201).json({ itinerary: data });
  }

  async listMine(req, res) {
    const items = await this.uc.listMyItineraries.execute({ ownerId: this.#owner(req) });
    res.json({ itineraries: items });
  }

  async getOne(req, res) {
    const data = await this.uc.getItinerary.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      lang: req.validatedQuery?.lang,
    });
    res.json({ itinerary: data });
  }

  async rename(req, res) {
    const data = await this.uc.renameItinerary.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      name: req.validated.name,
    });
    res.json({ itinerary: data });
  }

  async remove(req, res) {
    const data = await this.uc.deleteItinerary.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
    });
    res.json(data);
  }

  async addItem(req, res) {
    const data = await this.uc.addItineraryItem.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      placeId: req.validated.placeId,
      lang: req.validatedQuery?.lang,
    });
    res.status(201).json({ itinerary: data });
  }

  async removeItem(req, res) {
    const data = await this.uc.removeItineraryItem.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      itemId: req.validatedParams.itemId,
      lang: req.validatedQuery?.lang,
    });
    res.json({ itinerary: data });
  }

  async reorder(req, res) {
    const data = await this.uc.reorderItineraryItems.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      orderedIds: req.validated.orderedIds,
      lang: req.validatedQuery?.lang,
    });
    res.json({ itinerary: data });
  }

  async share(req, res) {
    const data = await this.uc.shareItinerary.execute({
      ownerId: this.#owner(req),
      itineraryId: req.validatedParams.id,
      enabled: req.validated.enabled,
    });
    res.json(data);
  }
}
