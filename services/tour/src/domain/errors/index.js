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
