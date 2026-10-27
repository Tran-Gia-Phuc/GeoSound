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

test('guest action, password visibility and backend request', async ({ page }) => {
  await fixtures(page);
  let payload;
  await page.route('**/api/auth/login', (route) => {
    payload = route.request().postDataJSON();
    return json(route, {
      user: { id: userId, role: 'tourist', fullName: 'Test' },
      accessToken: 'test',
      refreshToken: 'test',
    });
  });
  await page.goto('/login?next=%2Fitineraries');
  await expect(page.getByRole('link', { name: 'Tiếp tục khám phá' }).last()).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('test@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Password123');
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/itineraries$/);
  expect(payload).toEqual({ email: 'test@example.test', password: 'Password123' });
});
test('login design fits desktop and phone', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
    await noOverflow(page);
  }
});

test('desktop login introduction and form do not overlap', async ({ page }) => {
  for (const width of [1000, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    const story = await page.locator('.login-a-story').boundingBox();
    const form = await page.locator('.auth__card').boundingBox();
    expect(story).not.toBeNull();
    expect(form).not.toBeNull();
    expect(story.x + story.width).toBeLessThanOrEqual(form.x);
    await expect(page.getByRole('heading', { name: /Mỗi bước chân/ })).toBeVisible();
    await noOverflow(page);
  }
});
