// =========================================================
// Zod schema cho tìm kiếm tour công khai (UC02). Tham số đến từ query string
// nên dùng z.coerce cho số. Mọi tiêu chí đều tùy chọn (GET / rỗng = gợi ý phổ biến).
// =========================================================
import { z } from 'zod';
import { TOUR_TYPES } from '../../domain/entities/tour.js';

export const SORT_OPTIONS = Object.freeze(['popular', 'rating', 'recent', 'nearby']);

export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(), // từ khóa (tên/mô tả)
    city: z.string().trim().max(120).optional(), // lọc theo thành phố
    language: z.string().trim().toLowerCase().max(10).optional(), // ngôn ngữ gốc
    type: z.enum(TOUR_TYPES, { errorMap: () => ({ message: 'Loại tour không hợp lệ' }) }).optional(),
    sort: z.enum(SORT_OPTIONS).default('popular'),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  // "gần tôi" cần tọa độ người dùng.
  .refine((v) => v.sort !== 'nearby' || (v.lat !== undefined && v.lng !== undefined), {
    message: 'Sắp xếp "gần tôi" cần vị trí (lat, lng)',
    path: ['sort'],
  });
