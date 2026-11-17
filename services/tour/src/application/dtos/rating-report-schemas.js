// =========================================================
// UC05 — Zod schemas for rating report & admin resolution routes.
// =========================================================
import { z } from 'zod';
import {
  REPORT_REASONS,
  REPORT_DESCRIPTION_MAX,
  ADMIN_NOTE_MAX,
  RESOLVE_ACTIONS,
} from '../../domain/entities/tour-rating-report.js';
import {
  RATING_REPORTS_PAGE_DEFAULT,
  RATING_REPORTS_PAGE_MAX,
} from '../use-cases/tour-rating-reports.js';

export const submitRatingReportParamsSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
  ratingUserId: z.string().uuid('Mã đánh giá không hợp lệ'),
});

export const submitRatingReportBodySchema = z.object({
  reasonType: z.enum(Object.values(REPORT_REASONS), {
    errorMap: () => ({ message: 'Vui lòng chọn lý do báo cáo hợp lệ' }),
  }),
  description: z
    .string({ invalid_type_error: 'Mô tả không hợp lệ' })
    .max(REPORT_DESCRIPTION_MAX + 100, `Mô tả tối đa ${REPORT_DESCRIPTION_MAX} ký tự`)
    .nullable()
    .optional(),
});

export const adminRatingReportQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed', 'PENDING', 'RESOLVED', 'DISMISSED']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(RATING_REPORTS_PAGE_MAX).default(RATING_REPORTS_PAGE_DEFAULT),
});

export const resolveRatingReportParamsSchema = z.object({
  reportId: z.string().uuid('Mã báo cáo không hợp lệ'),
});

export const resolveRatingReportBodySchema = z.object({
  action: z.enum(Object.values(RESOLVE_ACTIONS), {
    errorMap: () => ({ message: 'Hành động xử lý không hợp lệ' }),
  }),
  adminNote: z
    .string({ invalid_type_error: 'Ghi chú không hợp lệ' })
    .max(ADMIN_NOTE_MAX, `Ghi chú tối đa ${ADMIN_NOTE_MAX} ký tự`)
    .nullable()
    .optional(),
});
