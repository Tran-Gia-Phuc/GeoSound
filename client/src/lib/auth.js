// =========================================================
// Gọi các endpoint xác thực (UC01) qua gateway /api/auth/*.
//   - login  -> { user, accessToken, refreshToken }  (lưu phiên)
//   - register (A1) gửi OTP -> verifyOtp tạo tài khoản -> login lấy token.
// Lưu phiên vào token-store để api.request({ auth:true }) tự gắn Bearer.
// =========================================================
import { api } from './api.js';
import { writeAuth, clearAuth, getAccessToken } from './token-store.js';
import { getDeviceId } from './device-id.js';

/** Đăng nhập, lưu phiên, trả về user. */
export async function login({ email, password }) {
  const body = await api.post('/api/auth/login', { email, password, deviceId: getDeviceId() });
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

/**
 * UC01 / UC23 R6 — change the password of the signed-in account.
 * POST /api/auth/change-password { currentPassword, newPassword } -> { message, revoked }.
 * This session stays signed in; every other session is signed out (`revoked` = how many).
 */
export async function changePassword({ currentPassword, newPassword }) {
  return api.post('/api/auth/change-password', { currentPassword, newPassword }, { auth: true });
}

/** Client check of a new password (same rule as Auth `Password`: 8+ characters, letters and digits). */
export function newPasswordProblem(password) {
  if (!password) return 'Vui lòng nhập mật khẩu mới';
  if (password.length < 8) return 'Mật khẩu phải có tối thiểu 8 ký tự';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Mật khẩu phải gồm cả chữ và số';
  return null;
}

/**
 * Sign out (UC23 A2): ask Auth to end this session, then clear the tokens.
 * The request is best effort: it starts with the current token before the
 * tokens are cleared and its errors are ignored, so sign-out never blocks.
 */
export function logout() {
  if (getAccessToken()) {
    api.post('/api/auth/logout', undefined, { auth: true }).catch(() => {});
  }
  clearAuth();
}
