// =========================================================
// ExploreController (UC07) — các GET CÔNG KHAI (không cần đăng nhập):
//   - khám phá địa điểm lẻ (/places)
//   - xem lịch trình được chia sẻ theo mã (/itineraries/shared/:token)
// =========================================================
export class ExploreController {
  /** @param {{ explorePlaces, getSharedItinerary }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    this.places = this.places.bind(this);
    this.shared = this.shared.bind(this);
  }

  async places(req, res) {
    const data = await this.uc.explorePlaces.execute(req.validatedQuery);
    res.json(data);
  }

  async shared(req, res) {
    const data = await this.uc.getSharedItinerary.execute({
      token: req.validatedParams.token,
      lang: req.validatedQuery?.lang,
    });
    res.json({ itinerary: data });
  }
}
