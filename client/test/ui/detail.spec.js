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

test('A detail columns retain real interactions', async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/tour/' + id);
  await expect(page.getByRole('heading', { name: tour.title, exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Lộ trình và điểm dừng' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nghe tại điểm này' })).toHaveCount(2);
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.detail__bar')).toBeVisible();
  await noOverflow(page);
});
test('404 never renders fabricated tour content', async ({ page }) => {
  await page.route('**/api/tours/**', (r) => json(r, { error: 'Not found' }, 404));
  await page.goto('/tour/' + id);
  await expect(page.getByRole('heading', { name: 'Tour không còn khả dụng' })).toBeVisible();
});
test('live detail connects to gateway', async ({ page }) => {
  test.skip(!process.env.LIVE_API_TESTS, 'Requires gateway');
  await page.setViewportSize({ width: 390, height: 844 });
  await liveRead(page, null, async (t) =>
    expect(page.getByRole('heading', { name: t.title, exact: true })).toBeVisible(),
  );
  await noOverflow(page);
});

test('GPS permission dialog stays in viewport and its action can be used', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
    localStorage.removeItem('geosound:gps-explained');
  });
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 650 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/tour/' + id);
    await page.getByRole('button', { name: 'Bắt đầu đi tour' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nghe tự động theo vị trí' });
    await expect(dialog).toBeVisible();
    await expect.poll(async () => { const b = await dialog.boundingBox(); return b.y + b.height; }).toBeLessThanOrEqual(viewport.height);
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bắt đầu đi tour' })).toBeFocused();
    await page.getByRole('button', { name: 'Bắt đầu đi tour' }).click();
    await dialog.getByRole('button', { name: 'Cho phép & bắt đầu' }).click();
    await expect(page).toHaveURL(/mode=gps/);
    await page.evaluate(() => localStorage.removeItem('geosound:gps-explained'));
  }
});
