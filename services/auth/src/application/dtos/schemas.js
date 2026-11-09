// =========================================================
// Zod schemas — kiểm tra "có mặt / đúng kiểu" ở biên HTTP (E1, E4).
// Quy tắc định dạng sâu hơn (email E5, mật khẩu E6) do Value Object trong
// domain đảm nhiệm, nên ở đây chỉ cần ràng buộc tối thiểu.
// =========================================================
import { z } from 'zod';
import { SELF_REGISTER_ROLES } from '../../domain/entities/user.js';
import { isValidAvatarUrl, AVATAR_URL_MAX } from '../../domain/value-objects/avatar-url.js';

const email = z.string({ required_error: 'Vui lòng nhập email' }).trim().min(1, 'Vui lòng nhập email');
const otp = z.string({ required_error: 'Vui lòng nhập OTP' }).trim().min(1, 'Vui lòng nhập OTP');

export const registerSchema = z.object({
  fullName: z.string({ required_error: 'Vui lòng nhập họ tên' }).trim().min(1, 'Vui lòng nhập họ tên'),
  email,
  password: z.string({ required_error: 'Vui lòng nhập mật khẩu' }).min(1, 'Vui lòng nhập mật khẩu'),
  role: z.enum(SELF_REGISTER_ROLES).optional(), // mặc định 'tourist'
});

export const verifyOtpSchema = z.object({ email, otp });

export const resendOtpSchema = z.object({
  email,
  purpose: z.enum(['register', 'reset']).default('register'),
});

// UC23 / R1 — random id kept by the client (local storage); optional for old clients.
const deviceId = z
  .string({ invalid_type_error: 'Mã thiết bị không hợp lệ' })
  .trim()
  .min(8, 'Mã thiết bị không hợp lệ')
  .max(100, 'Mã thiết bị không hợp lệ')
  .optional();

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Vui lòng nhập mật khẩu' }).min(1, 'Vui lòng nhập mật khẩu'),
  deviceId,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  email,
  otp,
  newPassword: z.string({ required_error: 'Vui lòng nhập mật khẩu mới' }).min(1, 'Vui lòng nhập mật khẩu mới'),
});

// UC23 / R7 — password change while signed in.
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Vui lòng nhập mật khẩu hiện tại' })
    .min(1, 'Vui lòng nhập mật khẩu hiện tại'),
  newPassword: z.string({ required_error: 'Vui lòng nhập mật khẩu mới' }).min(1, 'Vui lòng nhập mật khẩu mới'),
});

export const refreshSchema = z.object({
  refreshToken: z.string({ required_error: 'Thiếu refresh token' }).min(1, 'Thiếu refresh token'),
  deviceId,
});

// #329 — presence beat / leave: the UUID made once per browser by the client (lib/device-id.js).
export const presenceSchema = z.object({
  deviceId: z
    .string({ required_error: 'Thiếu mã thiết bị', invalid_type_error: 'Mã thiết bị không hợp lệ' })
    .uuid('Mã thiết bị không hợp lệ'),
});

// ---------- UC21 — admin account actions (docs/02-design/uc21-account-actions.md) ----------

const adminReason = z
  .string({ required_error: 'Vui lòng nhập lý do', invalid_type_error: 'Lý do không hợp lệ' })
  .trim()
  .min(1, 'Vui lòng nhập lý do')
  .max(1000, 'Lý do tối đa 1000 ký tự');

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(200, 'Từ khoá tối đa 200 ký tự').optional(),
  role: z.enum(['tourist', 'contributor', 'admin'], { invalid_type_error: 'Vai trò không hợp lệ' }).optional(),
  status: z.enum(['active', 'suspended', 'banned'], { invalid_type_error: 'Trạng thái không hợp lệ' }).optional(),
  page: z.coerce.number({ invalid_type_error: 'Trang không hợp lệ' }).int('Trang không hợp lệ').min(1, 'Trang không hợp lệ').default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Số dòng không hợp lệ' })
    .int('Số dòng không hợp lệ')
    .min(1, 'Số dòng từ 1 đến 50')
    .max(50, 'Số dòng từ 1 đến 50')
    .default(20),
});

export const adminReasonSchema = z.object({ reason: adminReason });

// Restore (A1): the reason is optional; blank counts as none.
export const adminRestoreSchema = z.object({
  reason: z
    .string({ invalid_type_error: 'Lý do không hợp lệ' })
    .trim()
    .max(1000, 'Lý do tối đa 1000 ký tự')
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// L13 — a preset (1, 7, 30 days) or an end date (ISO 8601 with a time and offset, e.g.
// toISOString()); exactly one of them. The range (future, at most 365 days) is checked by SuspendUser.
export const adminSuspendSchema = z
  .object({
    reason: adminReason,
    days: z
      .union([z.literal(1), z.literal(7), z.literal(30)], {
        errorMap: () => ({ message: 'Số ngày tạm khoá chỉ có thể là 1, 7 hoặc 30' }),
      })
      .optional(),
    until: z.string({ invalid_type_error: 'Thời hạn tạm khoá không hợp lệ' }).datetime({ offset: true, message: 'Thời hạn tạm khoá không hợp lệ' }).optional(),
  })
  .refine((b) => (b.days === undefined) !== (b.until === undefined), {
    message: 'Vui lòng chọn số ngày hoặc ngày kết thúc tạm khoá',
    path: ['days'],
  });

// ---------- UC18 — author page and follow (docs/02-design/uc18-author-page.md) ----------

export const followingQuerySchema = z.object({
  page: z.coerce.number({ invalid_type_error: 'Trang không hợp lệ' }).int('Trang không hợp lệ').min(1, 'Trang không hợp lệ').default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Số dòng không hợp lệ' })
    .int('Số dòng không hợp lệ')
    .min(1, 'Số dòng từ 1 đến 50')
    .max(50, 'Số dòng từ 1 đến 50')
    .default(20),
});

// A1 — at least one field; `null` (or blank) clears bio / avatar; fullName trimmed 1..120.
export const updateProfileSchema = z
  .object({
    fullName: z
      .string({ invalid_type_error: 'Họ tên không hợp lệ' })
      .trim()
      .min(1, 'Vui lòng nhập họ tên')
      .max(120, 'Họ tên tối đa 120 ký tự')
      .optional(),
    bio: z
      .string({ invalid_type_error: 'Giới thiệu không hợp lệ' })
      .trim()
      .max(500, 'Giới thiệu tối đa 500 ký tự')
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
    avatarUrl: z
      .string({ invalid_type_error: 'Ảnh đại diện không hợp lệ' })
      .trim()
      .max(AVATAR_URL_MAX, 'Đường dẫn ảnh đại diện tối đa 500 ký tự')
      .refine((v) => v === '' || isValidAvatarUrl(v), 'Ảnh đại diện không hợp lệ')
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .refine((b) => b.fullName !== undefined || b.bio !== undefined || b.avatarUrl !== undefined, {
    message: 'Không có thông tin nào để cập nhật',
    path: ['_'],
  });
