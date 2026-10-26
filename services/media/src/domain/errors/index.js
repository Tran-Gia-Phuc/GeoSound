// =========================================================
// Domain errors (media). Mỗi lỗi mang `status` (HTTP) + `code` (máy đọc) để
// errorHandler dùng chung trả về client.
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

// Loại file không hỗ trợ (vd .exe, .pdf) hoặc nội dung không khớp loại khai báo.
export class UnsupportedMediaError extends AppError {
  constructor(message = 'Định dạng file không được hỗ trợ') {
    super(message, { status: 415, code: 'unsupported_media' });
  }
}

// File rỗng hoặc vượt giới hạn dung lượng.
export class MediaSizeError extends AppError {
  /** @param {string} message */
  constructor(message) {
    super(message, { status: 413, code: 'media_too_large' });
  }
}

// Dịch vụ lưu trữ không phản hồi (cho thử lại).
export class StorageUnavailableError extends AppError {
  constructor(message = 'Không lưu được file, vui lòng thử lại') {
    super(message, { status: 503, code: 'storage_unavailable' });
  }
}
