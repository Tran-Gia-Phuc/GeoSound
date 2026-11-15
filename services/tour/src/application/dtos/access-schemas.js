// =========================================================
// UC14 (#269) — zod schemas of the restricted access routes (presence and type at the edge; the
// passcode rules (E1: 6..32 characters, no whitespace) live in domain/tour/restricted-access.js).
// =========================================================
import { z } from 'zod';

const passcode = z
  .string({ required_error: 'Vui lòng nhập mã truy cập', invalid_type_error: 'Mã truy cập không hợp lệ' })
  .max(200, 'Mã truy cập quá dài');

export const accessTourParamSchema = z.object({
  tourId: z.string().uuid('Mã tour không hợp lệ'),
});

export const testerTourParamSchema = z.object({
  id: z.string().uuid('Mã tour không hợp lệ'),
});

export const setPasscodeSchema = z.object({ passcode });

export const unlockSchema = z.object({
  passcode: passcode.refine((v) => v.trim().length > 0, 'Vui lòng nhập mã truy cập'),
});
