// =========================================================
// Composition Root (media) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) → use-case → interfaces.
//
//   domain              : MediaFile (loại/dung lượng/nội dung file)
//   application          : UploadMedia
//   infrastructure       : lưu trữ — Supabase Storage (production) hoặc ổ đĩa (dev), xem MEDIA_STORAGE
//   interfaces/http      : POST /uploads (+ GET /files/* khi lưu ổ đĩa)
//   interfaces/messaging : (sau) consumer render TTS
// =========================================================
import { selectStorage } from './infrastructure/storage/select-storage.js';
import { UploadMedia } from './application/use-cases/upload-media.js';
import { buildMediaRouter } from './interfaces/http/media-routes.js';

export function buildContainer(env = process.env) {
  const { storage, localDir } = selectStorage(env);
  const uploadMedia = new UploadMedia({ storage });
  const mediaRouter = buildMediaRouter({ uploadMedia });
  return { mediaRouter, localDir, storageName: storage.constructor.name };
}
