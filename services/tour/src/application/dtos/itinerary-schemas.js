// =========================================================
// Zod schemas cho UC07 — lịch trình cá nhân + khám phá địa điểm.
// Kiểm "có mặt / đúng kiểu" ở biên HTTP; quy tắc nghiệp vụ (tên, hoán vị thứ tự)
// do entity đảm nhiệm.
// =========================================================
import { z } from 'zod';

const uuid = z.string().uuid('Mã không hợp lệ');
const name = z
  .string({ required_error: 'Vui lòng đặt tên lịch trình' })
  .trim()
  .min(1, 'Vui lòng đặt tên lịch trình')
  .max(120, 'Tên lịch trình tối đa 120 ký tự');

export const createItinerarySchema = z.object({ name });
export const renameItinerarySchema = z.object({ name });

export const addItemSchema = z.object({ placeId: uuid });

export const reorderItemsSchema = z.object({
  orderedIds: z.array(uuid).min(1, 'Danh sách sắp xếp trống'),
});

export const shareSchema = z.object({ enabled: z.boolean().default(true) });

// --- params ---
export const itineraryIdParamSchema = z.object({ id: uuid });
export const itemParamSchema = z.object({ id: uuid, itemId: uuid });
export const shareTokenParamSchema = z.object({ token: z.string().min(1) });

// --- query ---
export const langQuerySchema = z.object({ lang: z.string().trim().min(1).optional() });

export const exploreQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
