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

test('Studio summaries and filters use real returned statuses', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.goto('/studio');
  await expect(page.getByRole('button', { name: 'Tất cả 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Bản nháp 1' }).click();
  await expect(page.locator('.studio-cardwrap')).toHaveCount(1);
  await page.getByLabel('Tìm tour của tôi', { exact: true }).fill('không có tour');
  await expect(page.getByRole('heading', { name: 'Không có tour khớp bộ lọc' })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(page.locator('.studio-cardwrap')).toHaveCount(2);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
  }
});
test('live own-tour library uses contributor API', async ({ page }) => {
  test.skip(!process.env.UI_AUTH_JSON, 'Requires test session');
  await page.addInitScript(
    (auth) => localStorage.setItem('geosound:auth', auth),
    process.env.UI_AUTH_JSON,
  );
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Tour của tôi', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
