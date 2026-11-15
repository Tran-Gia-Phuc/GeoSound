// =========================================================
// Zod schemas cho chi tiết tour công khai (UC02). :id là UUID; lang (tùy chọn)
// là ngôn ngữ nghe khách chọn (A2 — đổi ngôn ngữ cập nhật nhãn giọng).
// =========================================================
import { z } from 'zod';

export const detailParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

export const detailQuerySchema = z.object({
  lang: z.string().trim().toLowerCase().max(10).optional(),
});

// UC04 / UC12 — POST /:id/translations/:lang (a tourist asks for a language). The code is checked
// against the supported list in the use case (Language value object, 400).
export const translateParamSchema = detailParamSchema.extend({
  lang: z.string().trim().toLowerCase().min(2, 'Mã ngôn ngữ không hợp lệ').max(10),
});
