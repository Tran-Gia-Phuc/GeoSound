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
  expect(payload).toEqual({
    email: 'test@example.test',
    password: 'Password123',
    deviceId: expect.any(String),
  });
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

test('phone QR opens the public origin and is hidden on localhost', async ({ page }) => {
  const qr = page.getByRole('img', { name: 'Mã QR mở GeoSound trên điện thoại' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixtures(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /Mỗi bước chân/ })).toBeVisible();
  await expect(qr).toHaveCount(0);

  // A public host name: serve it from the test dev server, the API from the fixtures.
  const local = new URL(page.url()).origin;
  await page.route('http://geosound.test/**', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('http://geosound.test', local) });
    await route.fulfill({ response });
  });
  await fixtures(page);
  for (const width of [1000, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://geosound.test/login');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('data-url', 'http://geosound.test/');
    await expect(page.locator('.login-a-qr__url')).toHaveText('geosound.test');
    expect(await qr.locator('path').getAttribute('d')).toMatch(/^M\d+,\d+h1v1h-1z/);
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(qr).toBeHidden();
});
