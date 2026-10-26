// =========================================================
// Domain errors (tour). Mỗi lỗi mang sẵn `status` (HTTP) + `code` (máy đọc).
// Tầng interfaces (errorHandler dùng chung) chỉ cần đọc err.status để trả response.
// Ánh xạ với Exception Path của UC09: E2 (thiếu trường), E3 (ảnh sai) → ValidationError.
// =========================================================

export class AppError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string }} [opts] */
  constructor(message, { status = 400, code = 'bad_request' } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

// E2, E3 — dữ liệu nhập không hợp lệ (thiếu tên/ngôn ngữ gốc, ảnh bìa sai).
export class ValidationError extends AppError {
  /** @param {string} message @param {Record<string,string>} [details] */
  constructor(message, details) {
    super(message, { status: 400, code: 'validation_error' });
    if (details) this.details = details;
  }
}

// E3 (tour) — không tìm thấy tour (đã xóa / id sai).
export class TourNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy tour') {
    super(message, { status: 404, code: 'tour_not_found' });
  }
}

// Quy tắc nghiệp vụ — chỉ tác giả thao tác tour của mình.
export class NotTourOwnerError extends AppError {
  constructor(message = 'Bạn không có quyền thao tác tour này') {
    super(message, { status: 403, code: 'not_tour_owner' });
  }
}

// UC10 — không tìm thấy điểm dừng (đã xóa / id sai / không thuộc tour).
export class PlaceNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy địa điểm') {
    super(message, { status: 404, code: 'place_not_found' });
  }
}

// UC10 / E2 — vị trí nằm trong vùng cấm (quân sự, trường học, bệnh viện...).
// Kèm hình vùng (GeoJSON) để client VẼ vùng cấm lên bản đồ và gợi ý dời ghim ra
// ngoài, thay vì chỉ báo lỗi chung chung.
export class ForbiddenZoneError extends AppError {
  /** @param {{ name?: string, type?: string, geometry?: object }|string} [zone] vùng cấm, nếu biết */
  constructor(zone) {
    const info = typeof zone === 'string' ? { name: zone } : zone;
    super(
      info?.name
        ? `Vị trí nằm trong vùng cấm (${info.name}), vui lòng dời ra ngoài`
        : 'Vị trí nằm trong vùng cấm, vui lòng điều chỉnh',
      { status: 422, code: 'forbidden_zone' },
    );
    if (info) this.zone = { name: info.name ?? null, type: info.type ?? null, geometry: info.geometry ?? null };
  }
}

// UC13 / E1 — tour thiếu dữ liệu để xem thử (chưa có điểm dừng nào).
export class TourNotPreviewableError extends AppError {
  /** @param {{ places?: boolean, route?: boolean }} [missing] cái còn thiếu */
  constructor(missing) {
    super('Chưa thể xem thử: tour cần có ít nhất một điểm dừng', {
      status: 422,
      code: 'tour_not_previewable',
    });
    if (missing) this.missing = missing;
  }
}

// UC09 / A3 — tour chưa đủ điều kiện xuất bản. `missing` = các mục bắt buộc còn thiếu
// (key + nhãn) để client dẫn tác giả tới đúng chỗ cần sửa.
export class TourNotReadyError extends AppError {
  /** @param {Array<{ key: string, label: string }>} missing */
  constructor(missing = []) {
    super('Tour chưa đủ điều kiện xuất bản', { status: 422, code: 'tour_not_ready' });
    this.missing = missing;
  }
}

// UC09 / A3 — trạng thái hiện tại không cho phép xuất bản / gỡ xuống.
export class TourStatusTransitionError extends AppError {
  constructor(message) {
    super(message, { status: 409, code: 'invalid_status_transition' });
  }
}

// UC07 — không tìm thấy lịch trình (đã xoá / id sai / mã chia sẻ sai).
export class ItineraryNotFoundError extends AppError {
  constructor(message = 'Không tìm thấy lịch trình') {
    super(message, { status: 404, code: 'itinerary_not_found' });
  }
}

// UC07 — chỉ chủ sở hữu thao tác lịch trình của mình.
export class NotItineraryOwnerError extends AppError {
  constructor(message = 'Bạn không có quyền thao tác lịch trình này') {
    super(message, { status: 403, code: 'not_itinerary_owner' });
  }
}

// UC07 — địa điểm không thể thêm (không tồn tại hoặc không thuộc tour công khai).
// BR: chỉ hiển thị/ thêm địa điểm thuộc tour công khai.
export class PlaceNotAddableError extends AppError {
  constructor(message = 'Địa điểm không khả dụng để thêm vào lịch trình') {
    super(message, { status: 404, code: 'place_not_addable' });
  }
}

// UC12 / E1 — dịch vụ dịch không phản hồi (cho thử lại).
export class TranslationError extends AppError {
  constructor(message = 'Dịch tự động thất bại, vui lòng thử lại') {
    super(message, { status: 503, code: 'translation_unavailable' });
  }
}

// UC12 / E1 — dịch vụ TTS không phản hồi (cho thử lại).
export class TtsError extends AppError {
  constructor(message = 'Tạo giọng đọc TTS thất bại, vui lòng thử lại') {
    super(message, { status: 503, code: 'tts_unavailable' });
  }
}
