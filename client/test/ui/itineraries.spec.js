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

test('library rename persists and failed rename retains the draft', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  let fail = true;
  await page.route('**/api/itineraries/' + id, (r) => {
    if (r.request().method() === 'PATCH')
      return fail
        ? json(r, { error: 'Rename failed' }, 503)
        : json(r, { itinerary: { ...itinerary, name: r.request().postDataJSON().name } });
    return json(r, { itinerary });
  });
  await page.goto('/itineraries');
  await page.getByRole('button', { name: 'Đổi tên ' + itinerary.name, exact: true }).click();
  await page.getByLabel('Đổi tên lịch trình', { exact: true }).fill('Tên mới');
  await page.getByRole('button', { name: 'Lưu tên' }).click();
  await expect(page.getByRole('alert')).toContainText('Rename failed');
  await expect(page.getByLabel('Đổi tên lịch trình', { exact: true })).toHaveValue('Tên mới');
  fail = false;
  await page.getByRole('button', { name: 'Lưu tên' }).click();
  await expect(page.getByRole('link', { name: /Tên mới/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});
test('guest is invited to login without loading private lists', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/itineraries', (r) => {
    reads++;
    return json(r, { itineraries: library });
  });
  await page.goto('/itineraries');
  await expect(page.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(reads).toBe(0);
});
