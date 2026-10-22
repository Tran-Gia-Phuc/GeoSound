// =========================================================
// Zod schemas — kiểm tra "có mặt / đúng kiểu" ở biên HTTP (UC09 E2, E3).
// Quy tắc sâu hơn (ngôn ngữ thuộc tập hỗ trợ) do Value Object Language đảm nhiệm.
// =========================================================
import { z } from 'zod';
import { TOUR_TYPES } from '../../domain/entities/tour.js';

const title = z
  .string({ required_error: 'Vui lòng nhập tên tour' })
  .trim()
  .min(1, 'Vui lòng nhập tên tour')
  .max(200, 'Tên tour tối đa 200 ký tự');

const description = z.string().trim().max(2000, 'Mô tả tối đa 2000 ký tự');
const coverImageUrl = z.string().trim().url('Ảnh bìa không hợp lệ');
const originalLanguage = z
  .string({ required_error: 'Vui lòng chọn ngôn ngữ gốc' })
  .trim()
  .min(1, 'Vui lòng chọn ngôn ngữ gốc');
const type = z.enum(TOUR_TYPES, { errorMap: () => ({ message: 'Loại tour không hợp lệ' }) });

// Bước 4–7: tạo tour (tên + ngôn ngữ gốc bắt buộc).
export const createTourSchema = z.object({
  title,
  description: description.optional(),
  coverImageUrl: coverImageUrl.optional(),
  originalLanguage,
  type: type.optional(),
});

// A1: sửa tour — mọi trường tùy chọn, nhưng phải có ít nhất một thay đổi.
export const updateTourSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    coverImageUrl: coverImageUrl.optional(),
    originalLanguage: originalLanguage.optional(),
    type: type.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Không có thay đổi nào để lưu',
  });

// Tham số đường dẫn :id (UUID).
export const tourIdParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});
