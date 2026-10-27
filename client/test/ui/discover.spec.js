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

test('A desktop filters call the supported endpoints and preserve URLs', async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const filters = page.getByRole('region', { name: 'Bộ lọc khám phá' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Khám phá thế giới');
  await filters.getByLabel('Ngôn ngữ').selectOption('en');
  await expect(page).toHaveURL(/lang=en/);
  await filters.getByLabel('Loại tour').selectOption('walking');
  await expect(page).toHaveURL(/type=walking/);
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(filters).toBeHidden();
  await page.getByRole('button', { name: /Lọc/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await noOverflow(page);
});
test('live discovery reads backend content', async ({ page }) => {
  test.skip(!process.env.LIVE_API_TESTS, 'Requires the running gateway');
  await page.goto('/');
  await expect(page.locator('.tour-card').first()).toBeVisible();
  await noOverflow(page);
});
