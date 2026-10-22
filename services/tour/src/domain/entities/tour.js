// =========================================================
// Entity: Tour. Lõi nghiệp vụ UC09 (Quản lý tour của mình):
//   - tạo tour mặc định trạng thái "Nháp" (draft)
//   - chỉ tác giả thao tác tour của mình: isOwnedBy()
//   - sửa tour đã công khai → phải gửi duyệt lại: applyEdits()
// Thuần domain: không biết Prisma/HTTP. Repo map DB row <-> entity này.
// =========================================================

// Vòng đời tour (khớp danh sách trạng thái ở UC09 / kiểm duyệt 3 tầng).
export const TOUR_STATUS = Object.freeze({
  DRAFT: 'draft', // Nháp
  AI_CHECKING: 'ai_checking', // Chờ AI (UC15)
  AI_WARNING: 'ai_warning', // AI Warning
  PENDING_REVIEW: 'pending_review', // Chờ Admin duyệt (UC19)
  PUBLIC: 'public', // Công khai (đã duyệt)
  REJECTED: 'rejected', // Bị từ chối
  RESTRICTED: 'restricted', // Truy cập hạn chế (UC14)
  HIDDEN: 'hidden', // Đang bị ẩn
});

export const TOUR_TYPES = Object.freeze(['walking', 'driving', 'cycling', 'indoor']);

// Các trường contributor được sửa ở UC09 (nội dung mô tả tour).
// city/duration dùng cho tìm kiếm & hiển thị ở UC02.
export const EDITABLE_FIELDS = Object.freeze([
  'title',
  'description',
  'coverImageUrl',
  'originalLanguage',
  'type',
  'city',
  'duration',
]);

// Trạng thái "đang hiển thị với khách" — sửa nội dung thì phải gửi duyệt lại.
const LIVE_STATUSES = new Set([TOUR_STATUS.PUBLIC, TOUR_STATUS.RESTRICTED]);

export class Tour {
  /**
   * @param {{
   *   id?: string, title: string, description?: string, coverImageUrl?: string|null,
   *   originalLanguage: string, type?: string, status?: string, authorId: string,
   *   createdAt?: Date, updatedAt?: Date,
   * }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.title = props.title;
    this.description = props.description ?? '';
    this.coverImageUrl = props.coverImageUrl ?? null;
    this.originalLanguage = props.originalLanguage;
    this.type = props.type ?? 'walking';
    this.status = props.status ?? TOUR_STATUS.DRAFT;
    this.authorId = props.authorId;
    // UC02 — thành phố (lọc), thời lượng ước tính (phút), điểm đánh giá.
    this.city = props.city ?? null;
    this.duration = props.duration ?? null;
    // Hệ thống duy trì (UC05 cập nhật); mặc định 0 khi chưa có đánh giá.
    this.averageRating = props.averageRating ?? 0;
    this.ratingCount = props.ratingCount ?? 0;
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  /** Quy tắc: chỉ tác giả mới quản lý tour của mình. */
  isOwnedBy(userId) {
    return this.authorId === userId;
  }

  /** Tour đang hiển thị với khách du lịch (công khai / truy cập hạn chế). */
  isLive() {
    return LIVE_STATUSES.has(this.status);
  }

  /** UC02 — chỉ tour công khai (đã duyệt) mới hiện trong tìm kiếm công khai. */
  isPublic() {
    return this.status === TOUR_STATUS.PUBLIC;
  }

  /**
   * UC09 / A1 — áp các thay đổi nội dung. Nếu tour đang hiển thị thì đưa về
   * "Nháp" (sửa tour công khai → phải gửi duyệt lại ở UC15).
   * Giá trị đưa vào phải đã được chuẩn hóa/validate ở use-case.
   * @param {Record<string, any>} fields
   * @returns {boolean} requiresResubmit — có cần gửi duyệt lại không
   */
  applyEdits(fields) {
    for (const key of EDITABLE_FIELDS) {
      if (fields[key] !== undefined) this[key] = fields[key];
    }
    const requiresResubmit = this.isLive();
    if (requiresResubmit) this.status = TOUR_STATUS.DRAFT;
    return requiresResubmit;
  }

  /** Dữ liệu đầy đủ trả về cho chính tác giả (form chỉnh sửa). */
  toPublic() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      coverImageUrl: this.coverImageUrl,
      originalLanguage: this.originalLanguage,
      type: this.type,
      status: this.status,
      authorId: this.authorId,
      city: this.city,
      duration: this.duration,
      averageRating: this.averageRating,
      ratingCount: this.ratingCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Bản rút gọn cho danh sách "tour của tôi" (UC09 bước 2). */
  toSummary() {
    return {
      id: this.id,
      title: this.title,
      coverImageUrl: this.coverImageUrl,
      originalLanguage: this.originalLanguage,
      type: this.type,
      status: this.status,
      city: this.city,
      updatedAt: this.updatedAt,
    };
  }
}
