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

test('filtered failure stops loading and retry preserves filters', async ({ page }) => {
  await fixtures(page);
  let fail = true;
  await page.route('**/api/tours?**', (r) => {
    const u = new URL(r.request().url());
    if (u.searchParams.get('city') && fail)
      return json(r, { error: 'Search temporarily unavailable' }, 503);
    return json(r, { tours: [tour], total: 1, page: 1, limit: 12 });
  });
  await page.goto('/?city=Hội%20An&lang=vi');
  await expect(page.getByRole('alert')).toContainText('Search temporarily unavailable');
  await expect(page.locator('.skel-card')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.tour-card')).toHaveCount(1);
  await expect(page).toHaveURL(/city=/);
  await expect(page).toHaveURL(/lang=vi/);
});
test('initial failure can retry without reload', async ({ page }) => {
  await fixtures(page);
  let failed = true;
  await page.route('**/api/tours?**', (r) =>
    failed
      ? json(r, { error: 'Unavailable' }, 503)
      : json(r, { tours: [tour], total: 1, page: 1, limit: 12 }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.skel-card')).toHaveCount(0);
  await page.evaluate(() => (window.__kept = 'alive'));
  failed = false;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.tour-card')).toHaveCount(1);
  expect(await page.evaluate(() => window.__kept)).toBe('alive');
});
