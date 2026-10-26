// =========================================================
// Composition Root (media) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) → use-case → interfaces.
//
//   domain              : MediaFile (loại/dung lượng/nội dung file)
//   application          : UploadMedia
//   infrastructure       : lưu trữ — Supabase Storage (có cấu hình) hoặc ổ đĩa (dev)
//   interfaces/http      : POST /uploads (+ GET /files/* khi lưu ổ đĩa)
//   interfaces/messaging : (sau) consumer render TTS
// =========================================================
import { SupabaseStorage } from './infrastructure/storage/supabase-storage.js';
import { LocalDiskStorage } from './infrastructure/storage/local-disk-storage.js';
import { UploadMedia } from './application/use-cases/upload-media.js';
import { buildMediaRouter } from './interfaces/http/media-routes.js';

// Có SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → Supabase Storage; không thì ổ đĩa.
function selectStorage(env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      storage: new SupabaseStorage({
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.SUPABASE_STORAGE_BUCKET || 'geosound-media',
      }),
      localDir: null,
    };
  }
  const dir = env.MEDIA_DIR || '/data/media';
  return {
    storage: new LocalDiskStorage({
      dir,
      publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL || 'http://localhost:8080/api/media/files',
    }),
    localDir: dir,
  };
}

export function buildContainer(env = process.env) {
  const { storage, localDir } = selectStorage(env);
  const uploadMedia = new UploadMedia({ storage });
  const mediaRouter = buildMediaRouter({ uploadMedia });
  return { mediaRouter, localDir, storageName: storage.constructor.name };
}
