// =========================================================
// AuthController — mỏng: nhận req.validated, gọi use-case, trả JSON.
// KHÔNG chứa logic nghiệp vụ (nằm ở application). Lỗi ném ra errorHandler xử lý.
// UC23: login/refresh pass the device context; the session routes use req.user (verifyJwt).
// =========================================================
import { deviceContext, currentUser } from '../request-context.js';

export class AuthController {
  /** @param {{ registerUser, verifyRegistrationOtp, resendOtp, login, forgotPassword, resetPassword, refreshToken, listSessions?, revokeSession?, revokeOtherSessions?, logout?, changePassword?, sessionHeartbeat?, getOnlineDevices?, recordPresence?, leavePresence? }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    // Giữ `this` khi truyền thẳng method làm route handler.
    for (const m of [
      'register',
      'verifyOtp',
      'resendOtp',
      'login',
      'forgotPassword',
      'resetPassword',
      'refresh',
      'listSessions',
      'revokeSession',
      'revokeOtherSessions',
      'logout',
      'changePassword',
      'heartbeat',
      'onlineDevices',
      'presence',
      'leavePresence',
    ]) {
      this[m] = this[m].bind(this);
    }
  }

  // A1 — đăng ký (gửi OTP)
  async register(req, res) {
    const result = await this.uc.registerUser.execute(req.validated);
    res.status(202).json({ message: 'Đã gửi OTP tới email, vui lòng xác thực', ...result });
  }

  // A1.7–A1.9 — xác thực OTP, tạo tài khoản
  async verifyOtp(req, res) {
    const user = await this.uc.verifyRegistrationOtp.execute(req.validated);
    res.status(201).json({ message: 'Đăng ký thành công', user });
  }

  // A3 — gửi lại OTP
  async resendOtp(req, res) {
    const result = await this.uc.resendOtp.execute(req.validated);
    res.json({ message: 'Đã gửi lại OTP', ...result });
  }

  // Basic flow — đăng nhập
  async login(req, res) {
    const result = await this.uc.login.execute({ ...req.validated, ...deviceContext(req) });
    res.json({ message: 'Đăng nhập thành công', ...result });
  }

  // A2.1 — quên mật khẩu (gửi OTP)
  async forgotPassword(req, res) {
    const result = await this.uc.forgotPassword.execute(req.validated);
    res.json({ message: 'Nếu email tồn tại, OTP đặt lại mật khẩu đã được gửi', ...result });
  }

  // A2.2 — đặt lại mật khẩu
  async resetPassword(req, res) {
    const result = await this.uc.resetPassword.execute(req.validated);
    res.json({ message: 'Đặt lại mật khẩu thành công', ...result });
  }

  // Làm mới access token
  async refresh(req, res) {
    const result = await this.uc.refreshToken.execute({ ...req.validated, ...deviceContext(req) });
    res.json(result);
  }

  // UC23 — list the signed-in devices
  async listSessions(req, res) {
    const result = await this.uc.listSessions.execute(currentUser(req));
    res.json(result);
  }

  // UC23 / R4 — sign out another device
  async revokeSession(req, res) {
    await this.uc.revokeSession.execute({ ...currentUser(req), sessionId: req.params.id });
    res.status(204).end();
  }

  // UC23 / R5 — sign out every other device
  async revokeOtherSessions(req, res) {
    const result = await this.uc.revokeOtherSessions.execute(currentUser(req));
    res.json(result);
  }

  // UC23 — sign out the current device
  async logout(req, res) {
    await this.uc.logout.execute(currentUser(req));
    res.status(204).end();
  }

  // #265 — heartbeat of the current device (keeps it "online" for the admin view)
  async heartbeat(req, res) {
    await this.uc.sessionHeartbeat.execute(currentUser(req));
    res.status(204).end();
  }

  // #329 — presence beat of any visitor; with a valid token the session is touched too
  async presence(req, res) {
    await this.uc.recordPresence.execute({ deviceId: req.validated.deviceId, currentSid: req.user?.sid ?? null });
    res.status(204).end();
  }

  // #329 — the page was closed (sendBeacon): the device is no longer online
  async leavePresence(req, res) {
    await this.uc.leavePresence.execute({ deviceId: req.validated.deviceId });
    res.status(204).end();
  }

  // #265 — admin: devices known / signed in / online now, and the online list
  async onlineDevices(_req, res) {
    res.json(await this.uc.getOnlineDevices.execute());
  }

  // UC23 / R7 — change the password; the other devices are signed out
  async changePassword(req, res) {
    const result = await this.uc.changePassword.execute({ ...currentUser(req), ...req.validated });
    res.json({ message: 'Đổi mật khẩu thành công', ...result });
  }
}
