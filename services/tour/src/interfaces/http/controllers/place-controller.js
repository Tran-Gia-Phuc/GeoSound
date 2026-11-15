// =========================================================
// PlaceController (UC10) — mỏng: nhận req.validated(+Params), gọi use-case, trả JSON.
// authorId từ JWT (req.user.sub); tourId/placeId từ req.validatedParams.
// =========================================================

export class PlaceController {
  /** @param {{ addPlace, listPlaces, updatePlace, deletePlace, reorderPlaces }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['add', 'list', 'update', 'remove', 'reorder']) {
      this[m] = this[m].bind(this);
    }
  }

  // Bước 5–11 — thêm điểm
  async add(req, res) {
    const place = await this.uc.addPlace.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      ...req.validated,
    });
    res.status(201).json({ message: 'Đã thêm địa điểm', place });
  }

  // Danh sách điểm của tour
  async list(req, res) {
    const places = await this.uc.listPlaces.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
    });
    res.json({ places });
  }

  // A3 — sửa điểm
  async update(req, res) {
    const place = await this.uc.updatePlace.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      placeId: req.validatedParams.placeId,
      patch: req.validated,
    });
    res.json({ message: 'Đã lưu thay đổi địa điểm', place });
  }

  // A3 — xóa điểm
  async remove(req, res) {
    const result = await this.uc.deletePlace.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      placeId: req.validatedParams.placeId,
    });
    res.json({ message: 'Đã xóa địa điểm', ...result });
  }

  // A2 — sắp xếp lại thứ tự
  async reorder(req, res) {
    const places = await this.uc.reorderPlaces.execute({
      authorId: req.user.sub,
      tourId: req.validatedParams.tourId,
      orderedIds: req.validated.order,
    });
    res.json({ message: 'Đã cập nhật thứ tự', places });
  }
}
