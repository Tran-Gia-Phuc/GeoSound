// =========================================================
// UC19 — zod schemas for the admin review endpoints (HTTP boundary).
// A rejection / change request must carry a reason (1..1000 characters, same limit as the
// tour.rejected / tour.changes_requested events).
// =========================================================
import { z } from 'zod';

export const reviewTourIdParamSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});

export const reviewReasonSchema = z.object({
  reason: z
    .string({ required_error: 'Vui lòng nhập lý do', invalid_type_error: 'Lý do không hợp lệ' })
    .trim()
    .min(1, 'Vui lòng nhập lý do')
    .max(1000, 'Lý do tối đa 1000 ký tự'),
});
