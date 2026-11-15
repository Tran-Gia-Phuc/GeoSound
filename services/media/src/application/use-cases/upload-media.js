// =========================================================
// UC09/UC10 — Tải ảnh/audio lên cho tour (thay cho dán URL). Chỉ người đóng góp.
//   - MediaFile kiểm loại, dung lượng, nội dung (magic bytes)
//   - khoá lưu: <kind>s/<yyyy>/<mm>/<uploaderId>/<uuid>.<ext> (không dùng tên file
//     người dùng → không lộ thông tin, không đè nhau)
//   - trả URL công khai để lưu vào tour/điểm (coverImageUrl, images[].url, audioUrl)
// =========================================================
import { randomUUID } from 'node:crypto';
import { MediaFile } from '../../domain/value-objects/media-file.js';
import { AppError, StorageUnavailableError } from '../../domain/errors/index.js';

export class UploadMedia {
  /** @param {{ storage: import('../../domain/ports/index.js').MediaStorage, now?: () => Date, uuid?: () => string }} deps */
  constructor({ storage, now = () => new Date(), uuid = randomUUID }) {
    this.storage = storage;
    this.now = now;
    this.uuid = uuid;
  }

  /** @param {{ uploaderId: string, kind: string, contentType: string, data: Buffer }} input */
  async execute({ uploaderId, kind, contentType, data }) {
    const file = new MediaFile({ kind, contentType, data });

    const d = this.now();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const owner = String(uploaderId).replace(/[^a-zA-Z0-9-]/g, '');
    const key = `${file.kind}s/${yyyy}/${mm}/${owner}/${this.uuid()}.${file.ext}`;

    try {
      const { url } = await this.storage.put({ key, data: file.data, contentType: file.contentType });
      return { url, key, kind: file.kind, contentType: file.contentType, size: file.size };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new StorageUnavailableError();
    }
  }
}
