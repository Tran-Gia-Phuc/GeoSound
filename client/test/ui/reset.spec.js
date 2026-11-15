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

test('reset confirms password, calls endpoint and returns to login', async ({ page }) => {
  let resets = 0,
    logins = 0;
  await page.route('**/api/auth/forgot-password', (r) => json(r, { otpTtlSeconds: 120 }));
  await page.route('**/api/auth/reset-password', (r) => {
    resets++;
    expect(r.request().postDataJSON()).toEqual({
      email: 'test@example.test',
      otp: '123456',
      newPassword: 'Password123',
    });
    return json(r, { message: 'ok' });
  });
  await page.route('**/api/auth/login', (r) => {
    logins++;
    return json(r, { error: 'unexpected' }, 500);
  });
  await page.goto('/forgot-password?next=%2Fitineraries');
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByRole('button', { name: 'Gửi mã OTP', exact: true }).click();
  await page.getByLabel('Mã OTP').fill('123456');
  await page.locator('#newPassword').fill('Password123');
  await page.locator('#confirmPassword').fill('Different123');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await expect(page.getByText('Mật khẩu xác nhận không khớp')).toBeVisible();
  expect(resets).toBe(0);
  await page.locator('#confirmPassword').fill('Password123');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đã đặt lại mật khẩu' })).toBeVisible();
  expect(logins).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('geosound:auth'))).toBeNull();
  await page.getByRole('link', { name: 'Về đăng nhập' }).click();
  await expect(page).toHaveURL(/login[?]next=%2Fitineraries/);
});
test('reset OTP rejection keeps inputs', async ({ page }) => {
  await page.route('**/api/auth/forgot-password', (r) => json(r, { otpTtlSeconds: 120 }));
  await page.route('**/api/auth/reset-password', (r) =>
    json(r, { code: 'invalid_otp', error: 'OTP không hợp lệ' }, 400),
  );
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByRole('button', { name: 'Gửi mã OTP', exact: true }).click();
  await page.getByLabel('Mã OTP').fill('000000');
  await page.locator('#newPassword').fill('Password123');
  await page.locator('#confirmPassword').fill('Password123');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('OTP không hợp lệ');
  await expect(page.locator('#newPassword')).toHaveValue('Password123');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('reset password follows the backend password policy before submitting', async ({ page }) => {
  let resets = 0;
  await page.route('**/api/auth/forgot-password', (r) => json(r, { otpTtlSeconds: 120 }));
  await page.route('**/api/auth/reset-password', (r) => { resets++; return json(r, { message: 'ok' }); });
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByRole('button', { name: 'Gửi mã OTP', exact: true }).click();
  await page.getByLabel('Mã OTP').fill('123456');
  for (const [password, message] of [['Ab12', 'Mật khẩu phải có tối thiểu 8 ký tự'], ['abcdefgh', 'Mật khẩu phải gồm cả chữ và số'], ['12345678', 'Mật khẩu phải gồm cả chữ và số']]) {
    await page.locator('#newPassword').fill(password);
    await page.locator('#confirmPassword').fill(password);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await expect(page.getByText(message)).toBeVisible();
  }
  expect(resets).toBe(0);
});
