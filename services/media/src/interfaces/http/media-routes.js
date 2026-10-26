// =========================================================
// HTTP media (sau gateway: /api/media/* → ở đây là /*).
//   POST /uploads?kind=image|audio   (body = nội dung file, Content-Type = loại file)
//     → 201 { url, key, kind, contentType, size }
// Gửi file "thô" (không multipart) để không cần thư viện parse; client dùng
// fetch(url, { body: file }). Chỉ người đóng góp (soạn tour) được tải lên.
// =========================================================
import express, { Router } from 'express';
import { verifyJwt } from '../../../shared/middleware/index.js';
import { MediaSizeError } from '../../domain/errors/index.js';
import { MEDIA_KINDS } from '../../domain/value-objects/media-file.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_BYTES = Math.max(...Object.values(MEDIA_KINDS).map((k) => k.maxBytes));

/** @param {{ uploadMedia: import('../../application/use-cases/upload-media.js').UploadMedia }} deps */
export function buildMediaRouter({ uploadMedia }) {
  const r = Router();

  r.post(
    '/uploads',
    verifyJwt(['contributor']),
    express.raw({ type: () => true, limit: MAX_BYTES }),
    wrap(async (req, res) => {
      const result = await uploadMedia.execute({
        uploaderId: req.user.sub,
        kind: String(req.query.kind || ''),
        contentType: req.headers['content-type'],
        data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      });
      res.status(201).json(result);
    }),
  );

  // Vượt giới hạn body của express.raw → lỗi tiếng Việt thống nhất với domain.
  // eslint-disable-next-line no-unused-vars
  r.use((err, _req, _res, next) => {
    if (err?.type === 'entity.too.large') return next(new MediaSizeError('File quá lớn'));
    return next(err);
  });

  return r;
}
