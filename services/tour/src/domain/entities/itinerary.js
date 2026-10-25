// =========================================================
// Entity (aggregate root): Itinerary (UC07) — lịch trình cá nhân của khách.
// Gắn tài khoản (ownerId). Chứa các điểm (ItineraryItem) có thứ tự. Quy tắc:
//   - tên bắt buộc (E2);
//   - chỉ chủ sở hữu thao tác (kiểm ở use-case qua isOwnedBy);
//   - thêm/xoá/sắp xếp điểm cập nhật lại sequence liên tục 0..n-1.
// Chia sẻ (A4): sinh shareToken 1 lần, dùng lại cho các lần sau.
// Thuần domain: không biết Prisma/HTTP.
// =========================================================
import { ValidationError } from '../errors/index.js';

export class Itinerary {
  /**
   * @param {{
   *   id?: string, ownerId: string, name: string, shareToken?: string|null,
   *   items?: import('./itinerary-item.js').ItineraryItem[],
   *   createdAt?: Date, updatedAt?: Date,
   * }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.ownerId = props.ownerId;
    this.name = Itinerary.normalizeName(props.name);
    this.shareToken = props.shareToken ?? null;
    this.items = props.items ?? [];
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  // E2 — tên lịch trình bắt buộc.
  static normalizeName(name) {
    const v = String(name ?? '').trim();
    if (!v) throw new ValidationError('Vui lòng đặt tên lịch trình', { name: 'Vui lòng đặt tên lịch trình' });
    if (v.length > 120) throw new ValidationError('Tên lịch trình tối đa 120 ký tự', { name: 'Tối đa 120 ký tự' });
    return v;
  }

  isOwnedBy(userId) {
    return this.ownerId === userId;
  }

  rename(name) {
    this.name = Itinerary.normalizeName(name);
  }

  /** Thêm điểm vào cuối (A2); gán sequence kế tiếp. */
  addItem(item) {
    item.sequence = this.items.length;
    this.items.push(item);
    return item;
  }

  /** Xoá điểm theo id (A2); dồn lại thứ tự. */
  removeItem(itemId) {
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== itemId);
    if (this.items.length === before) return false;
    this.#resequence();
    return true;
  }

  /**
   * Sắp xếp lại theo danh sách id (A2). orderedIds phải là hoán vị đúng
   * tập id hiện có — nếu không, ném ValidationError.
   */
  reorder(orderedIds) {
    const current = new Set(this.items.map((it) => it.id));
    const next = new Set(orderedIds);
    const same = current.size === next.size && [...current].every((id) => next.has(id));
    if (!same) {
      throw new ValidationError('Danh sách sắp xếp không khớp các điểm hiện có');
    }
    const byId = new Map(this.items.map((it) => [it.id, it]));
    this.items = orderedIds.map((id) => byId.get(id));
    this.#resequence();
  }

  /** A4 — đảm bảo có mã chia sẻ (sinh 1 lần, dùng lại). */
  ensureShareToken(generate) {
    if (!this.shareToken) this.shareToken = generate();
    return this.shareToken;
  }

  /** Thu hồi chia sẻ. */
  revokeShare() {
    this.shareToken = null;
  }

  #resequence() {
    this.items.forEach((it, i) => (it.sequence = i));
  }

  toPublic() {
    return {
      id: this.id,
      ownerId: this.ownerId,
      name: this.name,
      shareToken: this.shareToken,
      items: this.items.map((it) => it.toPublic()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
