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

for (const item of [
  { code: 'account_locked', status: 423, text: 'Tài khoản tạm khóa' },
  { code: 'account_banned', status: 403, text: 'Tài khoản đã bị khóa' },
  { code: 'invalid_credentials', status: 401, text: 'Đăng nhập chưa thành công' },
])
  test('login recovery ' + item.code, async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      json(route, { code: item.code, error: 'Backend error' }, item.status),
    );
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('test@example.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Password123');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(item.text);
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('test@example.test');
    await expect(page).toHaveURL(/login/);
    if (item.code === 'account_locked')
      await expect(page.getByRole('link', { name: 'Đặt lại mật khẩu', exact: true })).toBeVisible();
  });
test('network failure remains recoverable', async ({ page }) => {
  await page.route('**/api/auth/login', (route) => route.abort('failed'));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Password123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa kết nối được máy chủ');
});
