// =========================================================
// Gọi các endpoint xác thực (UC01) qua gateway /api/auth/*.
//   - login  -> { user, accessToken, refreshToken }  (lưu phiên)
//   - register (A1) gửi OTP -> verifyOtp tạo tài khoản -> login lấy token.
// Lưu phiên vào token-store để api.request({ auth:true }) tự gắn Bearer.
// =========================================================
import { api } from './api.js';
import { writeAuth, clearAuth } from './token-store.js';

/** Đăng nhập, lưu phiên, trả về user. */
export async function login({ email, password }) {
  const body = await api.post('/api/auth/login', { email, password });
  const { user, accessToken, refreshToken } = body;
  writeAuth({ user, accessToken, refreshToken });
  return user;
}

/** A1 — đăng ký (gửi OTP tới email). Chưa tạo tài khoản.
 *  role: 'tourist' (mặc định ở auth service) | 'contributor' (tác giả tour). */
export async function register({ fullName, email, password, role }) {
  return api.post('/api/auth/register', { fullName, email, password, ...(role ? { role } : {}) });
}

/** A1.7 — xác thực OTP, tạo tài khoản. Trả { user } (chưa có token). */
export async function verifyOtp({ email, otp }) {
  return api.post('/api/auth/verify-otp', { email, otp });
}

/** A3 — gửi lại OTP. */
export async function resendOtp({ email, purpose = 'register' }) {
  return api.post('/api/auth/resend-otp', { email, purpose });
}

/** Đăng ký xong thì đăng nhập luôn để lấy token. */
export async function registerAndVerify({ fullName, email, password, otp }) {
  await verifyOtp({ email, otp });
  return login({ email, password });
}

/** A2.1 — quên mật khẩu: gửi OTP đặt lại (luôn trả chung chung, không lộ email tồn tại). */
export async function forgotPassword({ email }) {
  return api.post('/api/auth/forgot-password', { email });
}

/** A2.2 — xác thực OTP + đặt mật khẩu mới, rồi đăng nhập luôn. */
export async function resetPasswordAndLogin({ email, otp, newPassword }) {
  await api.post('/api/auth/reset-password', { email, otp, newPassword });
  return login({ email, password: newPassword });
}

export function logout() {
  clearAuth();
}
