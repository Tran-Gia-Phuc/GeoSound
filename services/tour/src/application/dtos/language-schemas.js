// =========================================================
// Zod schemas cho cấu hình đa ngôn ngữ & TTS (UC12). Kiểm cấu trúc ở đây;
// ngôn ngữ thuộc tập hỗ trợ kiểm ở Value Object Language, giọng ở TtsVoice.
// =========================================================
import { z } from 'zod';
import { TTS_GENDERS } from '../../domain/value-objects/tts-voice.js';
import { placeParamsSchema } from './place-schemas.js';

const langCode = z.string().trim().toLowerCase().min(2, 'Mã ngôn ngữ không hợp lệ').max(10);

const voice = z.object({
  gender: z.enum(TTS_GENDERS, { errorMap: () => ({ message: 'Giọng đọc TTS không hợp lệ (nam/nữ)' }) }),
  region: z.string().trim().max(50).optional(),
});

// Bước 3–9: đặt danh sách ngôn ngữ phụ + giọng TTS cho tour.
export const setLanguagesSchema = z.object({
  secondary: z.array(langCode).max(20, 'Tối đa 20 ngôn ngữ phụ').default([]),
  voice,
});

// A1: nghe thử TTS của một điểm theo ngôn ngữ.
export const previewTtsSchema = z.object({
  lang: langCode,
});

// A2: chỉnh bản dịch của một điểm theo ngôn ngữ.
export const updateTranslationSchema = z.object({
  text: z.string().trim().min(1, 'Bản dịch không được rỗng').max(5000, 'Bản dịch tối đa 5000 ký tự'),
});

// Tham số đường dẫn.
export { placeParamsSchema };
export const translationParamsSchema = placeParamsSchema.extend({
  lang: langCode,
});
