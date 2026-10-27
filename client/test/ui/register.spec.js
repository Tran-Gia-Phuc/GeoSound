import { test, expect } from '@playwright/test';
import {
  id,
  secondId,
  userId,
  places,
  tour,
  itinerary,
  library,
  languages,
  json,
  signIn,
  fixtures,
  noOverflow,
  liveRead,
} from './fixtures.js';

async function form(page, role = 'tourist') {
  await page.goto('/register?next=%2Fitineraries');
  if (role === 'contributor') await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await page.getByLabel('Họ và tên').fill('Test user');
  await page.getByLabel('Email', { exact: true }).fill('new@example.test');
  await page.locator('#password').fill('Password123');
  await page.locator('#confirmPassword').fill('Password123');
}
for (const role of ['tourist', 'contributor'])
  test('registration OTP completion ' + role, async ({ page }) => {
    let registered;
    let logins = 0;
    await page.route('**/api/auth/register', (r) => {
      registered = r.request().postDataJSON();
      return json(r, { otpTtlSeconds: 120 }, 202);
    });
    await page.route('**/api/auth/verify-otp', (r) => json(r, { user: { id: userId, role } }, 201));
    await page.route('**/api/auth/login', (r) => {
      logins++;
      return json(r, { error: 'unexpected' }, 500);
    });
    await form(page, role);
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(page.getByLabel('Mã OTP')).toBeVisible();
    await page.getByLabel('Mã OTP').fill('123456');
    await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đăng ký thành công!' })).toBeVisible();
    expect(registered.role).toBe(role);
    expect(registered.confirm).toBeUndefined();
    expect(logins).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('geosound:auth'))).toBeNull();
    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/login[?]next=%2Fitineraries/);
  });
test('confirmation, OTP errors and resend preserve recovery', async ({ page }) => {
  await page.clock.install();
  let requests = 0,
    resends = 0;
  await page.route('**/api/auth/register', (r) => {
    requests++;
    return json(r, { otpTtlSeconds: 120 }, 202);
  });
  await page.route('**/api/auth/verify-otp', (r) =>
    json(r, { code: 'invalid_otp', error: 'OTP không hợp lệ' }, 400),
  );
  await page.route('**/api/auth/resend-otp', (r) => {
    resends++;
    return json(r, { otpTtlSeconds: 120 });
  });
  await form(page);
  await page.locator('#confirmPassword').fill('Different123');
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(page.getByText('Mật khẩu xác nhận không khớp')).toBeVisible();
  expect(requests).toBe(0);
  await page.locator('#confirmPassword').fill('Password123');
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await page.getByLabel('Mã OTP').fill('000000');
  await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
  await expect(page.locator('#otp-err')).toContainText('OTP không hợp lệ');
  await expect(page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true })).toBeDisabled();
  await page.clock.fastForward(30000);
  await page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true }).click();
  expect(resends).toBe(1);
  await expect(page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Đổi email', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('new@example.test');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('expired OTP offers resend after cooldown without creating a session', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/auth/register', (r) => json(r, { otpTtlSeconds: 1 }, 202));
  await page.route('**/api/auth/verify-otp', (r) =>
    json(r, { code: 'challenge_expired', error: 'Phiên xác thực đã hết hạn' }, 410),
  );
  await form(page);
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await page.getByLabel('Mã OTP').fill('123456');
  await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
  await expect(page.locator('#otp-err')).toContainText('hết hạn');
  await expect(page.getByRole('button', { name: 'Gửi lại mã OTP' })).toBeDisabled();
  await page.clock.fastForward(30000);
  await expect(page.getByRole('button', { name: 'Gửi lại mã OTP' })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('geosound:auth'))).toBeNull();
});
