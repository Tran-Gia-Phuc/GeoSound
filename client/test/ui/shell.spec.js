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

test('Studio sidebar follows role and viewport', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/studio');
  const nav = page.getByRole('navigation', { name: 'Điều hướng Studio' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tour của tôi' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await nav.getByRole('link', { name: 'Tạo tour mới' }).click();
  await expect(page.getByRole('heading', { name: 'Tạo tour mới' })).toBeVisible();
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeHidden();
  await noOverflow(page);
});
test('tourist never gets contributor sidebar', async ({ page }) => {
  await fixtures(page);
  await signIn(page, 'tourist');
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Studio dành cho tác giả tour' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng Studio' })).toHaveCount(0);
});
