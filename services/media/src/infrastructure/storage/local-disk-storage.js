// =========================================================
// MediaStorage → ổ đĩa (DEV, khi chưa cấu hình Supabase Storage). File nằm ở
// MEDIA_DIR (volume docker) và được media service phục vụ tĩnh ở GET /files/*,
// qua gateway là {publicBaseUrl}/<key> (mặc định http://localhost:8080/api/media/files).
// =========================================================
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @implements {import('../../domain/ports/index.js').MediaStorage} */
export class LocalDiskStorage {
  /** @param {{ dir: string, publicBaseUrl: string }} opts */
  constructor({ dir, publicBaseUrl }) {
    this.dir = path.resolve(dir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
  }

  async put({ key, data }) {
    const target = path.resolve(this.dir, key);
    // Khoá do use-case sinh, nhưng vẫn chặn thoát khỏi thư mục gốc.
    if (!target.startsWith(this.dir + path.sep)) throw new Error('Khoá lưu trữ không hợp lệ');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
    return { url: `${this.publicBaseUrl}/${key}` };
  }
}
