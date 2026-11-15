// =========================================================
// UC20 (#273) — zod schemas of the admin report endpoints (HTTP boundary).
// Hide needs a reason (1..1000 after trim, 422 like UC19); restore and dismiss take an optional one.
// =========================================================
import { z } from 'zod';
import { ADMIN_REASON_MAX } from '../../domain/entities/admin-action.js';
import { QUEUE_PAGE_DEFAULT, QUEUE_PAGE_MAX } from '../../domain/tour/report-handling.js';

export const adminReportTourIdParamSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});

export const reportQueueQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'Trang không hợp lệ' })
    .int('Trang không hợp lệ')
    .min(1, 'Trang không hợp lệ')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Số dòng không hợp lệ' })
    .int('Số dòng không hợp lệ')
    .min(1, `Số dòng từ 1 đến ${QUEUE_PAGE_MAX}`)
    .max(QUEUE_PAGE_MAX, `Số dòng từ 1 đến ${QUEUE_PAGE_MAX}`)
    .default(QUEUE_PAGE_DEFAULT),
});

export const hideReasonSchema = z.object({
  reason: z
    .string({ required_error: 'Vui lòng nhập lý do', invalid_type_error: 'Lý do không hợp lệ' })
    .trim()
    .min(1, 'Vui lòng nhập lý do')
    .max(ADMIN_REASON_MAX, `Lý do tối đa ${ADMIN_REASON_MAX} ký tự`),
});

export const optionalReasonSchema = z.object({
  reason: z
    .string({ invalid_type_error: 'Lý do không hợp lệ' })
    .trim()
    .max(ADMIN_REASON_MAX, `Lý do tối đa ${ADMIN_REASON_MAX} ký tự`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});
