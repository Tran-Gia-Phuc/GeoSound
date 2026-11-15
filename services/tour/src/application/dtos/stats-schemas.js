// =========================================================
// UC17 (#271) — zod schemas of the statistics routes (shape at the edge; the domain checks the period).
// =========================================================
import { z } from 'zod';
import { ACTIVITY_ACTIONS } from '../../domain/entities/tour-stats.js';

export const statsTourParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

// Language code like the UC12 config (vi, en, zh-tw); lower-cased.
const language = z
  .string({ invalid_type_error: 'Ngôn ngữ không hợp lệ' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'Ngôn ngữ không hợp lệ');

export const recordActivitySchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS, {
    errorMap: (issue, ctx) => ({ message: ctx.data === undefined ? 'Thiếu hành động' : 'Hành động không hợp lệ' }),
  }),
  language: language.optional(),
  // Same shape as Auth's device id (UC23): random id kept by the client.
  deviceId: z
    .string({ invalid_type_error: 'Mã thiết bị không hợp lệ' })
    .trim()
    .min(8, 'Mã thiết bị không hợp lệ')
    .max(100, 'Mã thiết bị không hợp lệ')
    .optional(),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ (YYYY-MM-DD)');

export const statsQuerySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  language: language.optional(),
});
