// =========================================================
// UC01 — test use-case bằng FAKE ports trong RAM (không cần DB/Redis).
// Minh họa lợi ích của clean architecture: domain/application thuần, dễ test.
// Chạy: npm test  (node:test, Node >= 20)
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RegisterUser } from '../src/application/use-cases/register-user.js';
import { VerifyRegistrationOtp } from '../src/application/use-cases/verify-registration-otp.js';
import { Login } from '../src/application/use-cases/login.js';
import { ForgotPassword } from '../src/application/use-cases/forgot-password.js';
import { ResetPassword } from '../src/application/use-cases/reset-password.js';

// ---------- Fakes ----------
class FakeUserRepo {
  constructor() {
    this.rows = new Map();
    this.seq = 0;
  }
  async findByEmail(email) {
    return [...this.rows.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async create(user) {
    user.id = `u${++this.seq}`;
    this.rows.set(user.id, user);
    return user;
  }
  async save(user) {
    this.rows.set(user.id, user);
    return user;
  }
}

class FakeChallenges {
  constructor() {
    this.map = new Map();
  }
  k(kind, email) {
    return `${kind}:${email}`;
  }
  async save(kind, email, payload) {
    this.map.set(this.k(kind, email), payload);
  }
  async get(kind, email) {
    return this.map.get(this.k(kind, email)) ?? null;
  }
  async delete(kind, email) {
    this.map.delete(this.k(kind, email));
  }
}

const fakeHasher = {
  async hash(p) {
    return `h:${p}`;
  },
  async compare(p, h) {
    return h === `h:${p}`;
  },
};
const fakeTokens = {
  issueTokens: (u) => ({ accessToken: `at:${u.id}`, refreshToken: `rt:${u.id}`, expiresIn: '15m' }),
  verifyRefresh: (t) => ({ sub: t.split(':')[1] }),
};
const fixedOtp = { generate: () => '123456' };
const noMail = { async sendOtp() {} };

function makeKit() {
  const userRepo = new FakeUserRepo();
  const challenges = new FakeChallenges();
  return { userRepo, challenges };
}

// ---------- Tests ----------
test('đăng ký -> OTP -> xác thực tạo được tài khoản, rồi đăng nhập thành công', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const verify = new VerifyRegistrationOtp({ userRepo, challenges });
  const login = new Login({ userRepo, hasher: fakeHasher, tokens: fakeTokens, policy: { maxAttempts: 5, lockMs: 60000 } });

  await register.execute({ fullName: 'An', email: 'An@Mail.com', password: 'abc12345', role: 'contributor' });
  const user = await verify.execute({ email: 'an@mail.com', otp: '123456' });
  assert.equal(user.email, 'an@mail.com');
  assert.equal(user.role, 'contributor');

  const res = await login.execute({ email: 'an@mail.com', password: 'abc12345' });
  assert.equal(res.accessToken, `at:${user.id}`);
});

test('E6 — mật khẩu không hợp lệ bị từ chối khi đăng ký', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  await assert.rejects(() => register.execute({ fullName: 'An', email: 'a@mail.com', password: 'short' }), /8 ký tự/);
});

test('E7 — email đã tồn tại không đăng ký lại được', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const verify = new VerifyRegistrationOtp({ userRepo, challenges });
  await register.execute({ fullName: 'An', email: 'a@mail.com', password: 'abc12345' });
  await verify.execute({ email: 'a@mail.com', otp: '123456' });
  await assert.rejects(() => register.execute({ fullName: 'An2', email: 'a@mail.com', password: 'abc12345' }), /đã được đăng ký/);
});

test('E8 — OTP sai bị từ chối', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const verify = new VerifyRegistrationOtp({ userRepo, challenges });
  await register.execute({ fullName: 'An', email: 'a@mail.com', password: 'abc12345' });
  await assert.rejects(() => verify.execute({ email: 'a@mail.com', otp: '000000' }), /OTP không hợp lệ/);
});

test('E2 — sai mật khẩu đủ ngưỡng thì bị tạm khóa (423)', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const verify = new VerifyRegistrationOtp({ userRepo, challenges });
  const login = new Login({ userRepo, hasher: fakeHasher, tokens: fakeTokens, policy: { maxAttempts: 3, lockMs: 60000 } });
  await register.execute({ fullName: 'An', email: 'a@mail.com', password: 'abc12345' });
  await verify.execute({ email: 'a@mail.com', otp: '123456' });

  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => login.execute({ email: 'a@mail.com', password: 'wrong123' }), /không đúng/);
  }
  // Lần sai thứ 3 -> đạt ngưỡng -> khóa.
  await assert.rejects(() => login.execute({ email: 'a@mail.com', password: 'wrong123' }), (e) => e.status === 423);
  // Đang khóa: dù đúng mật khẩu vẫn bị chặn.
  await assert.rejects(() => login.execute({ email: 'a@mail.com', password: 'abc12345' }), (e) => e.status === 423);
});

test('A2 — quên mật khẩu rồi đặt lại, đăng nhập bằng mật khẩu mới', async () => {
  const { userRepo, challenges } = makeKit();
  const register = new RegisterUser({ userRepo, hasher: fakeHasher, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const verify = new VerifyRegistrationOtp({ userRepo, challenges });
  const forgot = new ForgotPassword({ userRepo, challenges, otp: fixedOtp, mailer: noMail, otpTtlSeconds: 120 });
  const reset = new ResetPassword({ userRepo, hasher: fakeHasher, challenges });
  const login = new Login({ userRepo, hasher: fakeHasher, tokens: fakeTokens, policy: { maxAttempts: 5, lockMs: 60000 } });

  await register.execute({ fullName: 'An', email: 'a@mail.com', password: 'abc12345' });
  await verify.execute({ email: 'a@mail.com', otp: '123456' });
  await forgot.execute({ email: 'a@mail.com' });
  await reset.execute({ email: 'a@mail.com', otp: '123456', newPassword: 'new12345' });

  const res = await login.execute({ email: 'a@mail.com', password: 'new12345' });
  assert.ok(res.accessToken);
});
