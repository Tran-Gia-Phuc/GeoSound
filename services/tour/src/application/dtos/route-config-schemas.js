// =========================================================
// Zod schemas cho cấu hình route & kích hoạt (UC11). Kiểm cấu trúc ở đây;
// kiểm hình học sâu (bán kính > 0, đa giác khép kín — E1) ở value object
// ActivationZone. Toàn bộ config lưu một lần (bước 8 "Lưu cấu hình").
// =========================================================
import { z } from 'zod';
// Dùng lại kiểm tourId ở đường dẫn (đã có ở UC10).
import { tourIdParamSchema } from './place-schemas.js';

const lat = z.number({ required_error: 'Thiếu vĩ độ (lat)' }).min(-90).max(90);
const lng = z.number({ required_error: 'Thiếu kinh độ (lng)' }).min(-180).max(180);
const coordinate = z.object({ lat, lng });

// Vùng kích hoạt: tròn (center + bán kính) hoặc đa giác (GeoJSON Polygon).
const circleZone = z.object({
  shape: z.literal('circle'),
  center: coordinate,
  radiusMeters: z
    .number({ required_error: 'Thiếu bán kính vùng kích hoạt' })
    .positive('Bán kính vùng kích hoạt phải lớn hơn 0') // E1
    .max(100000, 'Bán kính tối đa 100km'),
});
const polygonZone = z.object({
  shape: z.literal('polygon'),
  geometry: z.object({
    type: z.literal('Polygon'),
    // [[ [lng,lat], ... ]] — độ khép kín/số đỉnh kiểm ở ActivationZone (E1).
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
  }),
});
const activationZone = z.discriminatedUnion('shape', [circleZone, polygonZone], {
  errorMap: () => ({ message: 'Loại vùng kích hoạt không hợp lệ (tròn hoặc đa giác)' }),
});

// Gợi ý "đi tiếp đến đâu" phát sau khi nghe xong điểm — cần text hoặc audio.
const nextHint = z
  .object({
    text: z.string().trim().max(500, 'Gợi ý tối đa 500 ký tự').optional(),
    audioUrl: z.string().trim().url('Audio gợi ý không hợp lệ').optional(),
  })
  .refine((h) => Boolean(h.text || h.audioUrl), { message: 'Gợi ý cần có text hoặc audio' });

// Vùng kích hoạt + độ ưu tiên (khi chồng nhau) + gợi ý, cho một điểm.
const trigger = z.object({
  placeId: z.string().uuid('Mã địa điểm không hợp lệ'),
  zone: activationZone,
  priority: z.number().int('Độ ưu tiên phải là số nguyên').min(0).max(1000).default(0),
  nextHint: nextHint.optional(),
});

// Audio chỉ đường tại ngã rẽ, có vùng kích hoạt riêng. Có thể dùng file audio
// HOẶC để giọng máy đọc lời nhắc (text; trống thì đọc nhãn).
const navAudio = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Nhãn audio chỉ đường là bắt buộc').max(200),
  audioUrl: z.string().trim().url('Audio chỉ đường không hợp lệ').optional(),
  text: z.string().trim().max(500, 'Lời nhắc tối đa 500 ký tự').optional(),
  zone: activationZone,
});

// Bước 8 — lưu toàn bộ cấu hình (route + vùng + ưu tiên + audio chỉ đường/gợi ý).
export const saveRouteConfigSchema = z.object({
  path: z.array(coordinate).max(5000, 'Route quá dài').optional(),
  triggers: z.array(trigger).max(500, 'Quá nhiều vùng kích hoạt').optional(),
  navAudios: z.array(navAudio).max(500, 'Quá nhiều audio chỉ đường').optional(),
});

export { tourIdParamSchema };
