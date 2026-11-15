// =========================================================
// Zod schemas cho điểm dừng (UC10). Mô tả text BẮT BUỘC (E3).
// Biên hợp lệ lat/lng cũng kiểm lại sâu ở Value Object Coordinates.
// =========================================================
import { z } from 'zod';
import { PLACE_TYPES } from '../../domain/entities/place.js';

const name = z
  .string({ required_error: 'Vui lòng nhập tên địa điểm' })
  .trim()
  .min(1, 'Vui lòng nhập tên địa điểm')
  .max(200, 'Tên địa điểm tối đa 200 ký tự');

// E3 — mô tả là bắt buộc.
const description = z
  .string({ required_error: 'Mô tả là bắt buộc' })
  .trim()
  .min(1, 'Mô tả là bắt buộc')
  .max(5000, 'Mô tả tối đa 5000 ký tự');

const lat = z.number({ required_error: 'Thiếu vĩ độ (lat)' }).min(-90).max(90);
const lng = z.number({ required_error: 'Thiếu kinh độ (lng)' }).min(-180).max(180);
const type = z.enum(PLACE_TYPES, { errorMap: () => ({ message: 'Loại địa điểm không hợp lệ' }) });

const image = z.object({
  url: z.string().trim().url('Ảnh không hợp lệ'),
  caption: z.string().trim().max(300, 'Chú thích tối đa 300 ký tự').optional(),
});
const images = z.array(image).max(20, 'Tối đa 20 ảnh mỗi điểm');
const audioUrl = z.string().trim().url('Audio không hợp lệ');

// Bước 5–10: thêm điểm.
export const addPlaceSchema = z.object({
  name,
  type: type.optional(),
  description,
  lat,
  lng,
  images: images.optional(),
  audioUrl: audioUrl.optional(),
});

// A3: sửa điểm — mọi trường tùy chọn; audioUrl có thể null để gỡ audio người thật.
export const updatePlaceSchema = z
  .object({
    name: name.optional(),
    type: type.optional(),
    description: description.optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    images: images.optional(),
    audioUrl: audioUrl.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Không có thay đổi nào để lưu',
  });

// A2: sắp xếp lại thứ tự — danh sách id theo thứ tự mới.
export const reorderPlacesSchema = z.object({
  order: z.array(z.string().uuid('Mã địa điểm không hợp lệ')).min(1, 'Danh sách thứ tự rỗng'),
});

// Tham số đường dẫn.
export const tourIdParamSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});
export const placeParamsSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
  placeId: z.string().uuid('Mã địa điểm không hợp lệ'),
});
