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

test('load failure is not an empty library and retry keeps session', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  let fail = true;
  await page.route('**/api/itineraries', (r) =>
    fail ? json(r, { error: 'Library unavailable' }, 503) : json(r, { itineraries: library }),
  );
  await page.goto('/itineraries');
  await expect(page.getByRole('alert')).toContainText('Library unavailable');
  await expect(page.getByRole('heading', { name: 'Chưa có lịch trình nào' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Thử lại danh sách' }).click();
  await expect(page.getByText(itinerary.name, { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const store = await import('/src/lib/token-store.js');
    store.clearAuth();
  });
  await expect(page.getByText(itinerary.name, { exact: true })).toHaveCount(0);
});
test('successful empty list has its own state', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.route('**/api/itineraries', (r) => json(r, { itineraries: [] }));
  await page.goto('/itineraries');
  await expect(page.getByRole('heading', { name: 'Chưa có lịch trình nào' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('account change clears previous owner data before next read', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  let first = true;
  await page.route('**/api/itineraries', async (r) => {
    if (first) return json(r, { itineraries: library });
    await new Promise((resolve) => setTimeout(resolve, 700));
    return json(r, { itineraries: [{ ...library[0], name: 'New owner itinerary' }] });
  });
  await page.goto('/itineraries');
  await expect(page.getByText(itinerary.name, { exact: true })).toBeVisible();
  first = false;
  await page.evaluate(async (identity) => {
    const store = await import('/src/lib/token-store.js');
    store.writeAuth({
      user: { id: identity, role: 'tourist', fullName: 'Other owner' },
      accessToken: 'other',
      refreshToken: 'other-refresh',
    });
  }, secondId);
  await expect(page.getByText(itinerary.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText('New owner itinerary', { exact: true })).toBeVisible();
});
