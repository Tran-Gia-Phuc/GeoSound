// =========================================================
// UC25 (#446) — zod schemas of the payment routes (types at the edge; the price range lives in
// domain/tour/tour-price.js, the MoMo IPN body is checked by its signature in the use case).
// =========================================================
import { z } from 'zod';

export const priceTourParamSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});

export const buyTourParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

export const orderParamSchema = z.object({
  orderId: z.string().uuid('Mã đơn thanh toán không hợp lệ'),
});

export const setPriceSchema = z.object({
  price: z.number({ required_error: 'Vui lòng nhập giá', invalid_type_error: 'Giá phải là số' }),
});
