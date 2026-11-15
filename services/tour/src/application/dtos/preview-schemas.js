// =========================================================
// Zod schemas cho xem thử tour (UC13). :tourId là UUID; lang (tùy chọn) là ngôn
// ngữ nghe thử (giống UC02 — đổi ngôn ngữ cập nhật nhãn giọng + text/audio).
// =========================================================
import { z } from 'zod';

export const previewParamsSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});

export const previewQuerySchema = z.object({
  lang: z.string().trim().toLowerCase().max(10).optional(),
});
