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
  await liveRead(page, null, async (t) =>
    expect(page.getByRole('heading', { name: t.title, exact: true })).toBeVisible(),
  );
});
