// =========================================================
// Zod schemas — kiểm tra "có mặt / đúng kiểu" ở biên HTTP (E1, E4).
// Quy tắc định dạng sâu hơn (email E5, mật khẩu E6) do Value Object trong
// domain đảm nhiệm, nên ở đây chỉ cần ràng buộc tối thiểu.
// =========================================================
import { z } from 'zod';
import { SELF_REGISTER_ROLES } from '../../domain/entities/user.js';

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
