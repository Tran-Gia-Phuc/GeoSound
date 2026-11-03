// =========================================================
// UC05 (#267) — zod schemas of the rating routes (presence and type at the edge; the domain
// normalizes the comment). E2: missing stars -> "Vui lòng chọn số sao".
// =========================================================
import { z } from 'zod';
import { RATING_COMMENT_MAX } from '../../domain/entities/tour-rating.js';
import { RATINGS_PAGE_DEFAULT, RATINGS_PAGE_MAX } from '../use-cases/tour-ratings.js';

export const ratingTourParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

export const ratingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(RATINGS_PAGE_MAX).default(RATINGS_PAGE_DEFAULT),
});

export const saveRatingSchema = z.object({
  stars: z
    .number({ required_error: 'Vui lòng chọn số sao', invalid_type_error: 'Vui lòng chọn số sao' })
    .int('Số sao phải từ 1 đến 5')
    .min(1, 'Số sao phải từ 1 đến 5')
    .max(5, 'Số sao phải từ 1 đến 5'),
  comment: z
    .string({ invalid_type_error: 'Nhận xét không hợp lệ' })
    .max(RATING_COMMENT_MAX + 200, `Nhận xét tối đa ${RATING_COMMENT_MAX} ký tự`) // trimmed length checked in the domain
    .nullable()
    .optional(),
});
