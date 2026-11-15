// =========================================================
// UC22 (#275) / UC21 (#274) — zod schemas of the admin dashboard, log and violation endpoints.
// Dates: `YYYY-MM-DD` (a whole UTC day) or an ISO date-time; the period rules (order, 366 days) are
// checked by the use case (domain/tour/admin-insights.js).
// =========================================================
import { z } from 'zod';
import { ADMIN_ACTIONS, ADMIN_TARGET } from '../../domain/entities/admin-action.js';
import { LOG_PAGE_DEFAULT, LOG_PAGE_MAX } from '../../domain/tour/admin-insights.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateParam = z
  .string({ invalid_type_error: 'Thời gian không hợp lệ' })
  .trim()
  .refine(
    (v) => (DATE_ONLY.test(v) || z.string().datetime({ offset: true }).safeParse(v).success) && !Number.isNaN(Date.parse(v)),
    'Thời gian không hợp lệ (YYYY-MM-DD hoặc ISO 8601)',
  )
  .optional();

export const dashboardQuerySchema = z.object({ from: dateParam, to: dateParam });

const optionalText = (message) => z.string({ invalid_type_error: message }).trim().min(1, message).max(100, message).optional();

export const adminActionQuerySchema = z.object({
  adminId: optionalText('Mã admin không hợp lệ'),
  action: z.enum(ADMIN_ACTIONS, { errorMap: () => ({ message: 'Loại hành động không hợp lệ' }) }).optional(),
  targetType: z
    .enum(Object.values(ADMIN_TARGET), { errorMap: () => ({ message: 'Loại đối tượng không hợp lệ' }) })
    .optional(),
  targetId: optionalText('Mã đối tượng không hợp lệ'),
  from: dateParam,
  to: dateParam,
  page: z.coerce
    .number({ invalid_type_error: 'Trang không hợp lệ' })
    .int('Trang không hợp lệ')
    .min(1, 'Trang không hợp lệ')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Số dòng không hợp lệ' })
    .int('Số dòng không hợp lệ')
    .min(1, `Số dòng từ 1 đến ${LOG_PAGE_MAX}`)
    .max(LOG_PAGE_MAX, `Số dòng từ 1 đến ${LOG_PAGE_MAX}`)
    .default(LOG_PAGE_DEFAULT),
});

export const adminActionIdParamSchema = z.object({
  id: z.string().uuid('Mã bản ghi không hợp lệ'),
});

export const violationUserParamSchema = z.object({
  userId: z.string().uuid('Mã người dùng không hợp lệ'),
});
