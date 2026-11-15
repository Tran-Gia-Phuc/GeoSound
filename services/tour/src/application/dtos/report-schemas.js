// =========================================================
// UC06 (#268) — zod schemas of the report routes (presence and type at the edge; the domain trims
// the note and requires it for `other`). E2: missing reason -> "Vui lòng chọn lý do báo cáo".
// =========================================================
import { z } from 'zod';
import { REPORT_REASONS, REPORT_NOTE_MAX, MSG_REASON_REQUIRED } from '../../domain/entities/tour-report.js';

export const reportTourParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

export const reportTourSchema = z.object({
  // Missing, null, empty or not a string -> E2 message; an unknown value -> "invalid reason".
  reason: z.enum(REPORT_REASONS, {
    errorMap: (issue, ctx) =>
      issue.code === 'invalid_enum_value' && ctx.data !== ''
        ? { message: 'Lý do báo cáo không hợp lệ' }
        : { message: MSG_REASON_REQUIRED },
  }),
  note: z
    .string({ invalid_type_error: 'Mô tả không hợp lệ' })
    .max(REPORT_NOTE_MAX + 200, `Mô tả tối đa ${REPORT_NOTE_MAX} ký tự`) // trimmed length checked in the domain
    .nullable()
    .optional(),
});
