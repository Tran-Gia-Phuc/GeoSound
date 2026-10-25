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

/** A1 — đăng ký (gửi OTP tới email). Chưa tạo tài khoản. */
export async function register({ fullName, email, password }) {
  // role mặc định 'tourist' ở phía auth service.
  return api.post('/api/auth/register', { fullName, email, password });
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

export function logout() {
  clearAuth();
}
