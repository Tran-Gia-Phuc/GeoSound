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

test('editor uses split layout and retains failed rename', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  let fail = true;
  await page.route('**/api/itineraries/' + id, (r) =>
    r.request().method() === 'PATCH'
      ? fail
        ? json(r, { error: 'Save failed' }, 503)
        : json(r, { itinerary })
      : json(r, { itinerary }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/itineraries/' + id);
  await page.getByRole('button', { name: itinerary.name, exact: true }).click();
  await page.getByRole('textbox', { name: 'Tên lịch trình' }).fill('Bản nhập được giữ');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tên lịch trình' })).toHaveValue(
    'Bản nhập được giữ',
  );
  await expect(page.getByRole('alert')).toContainText('Save failed');
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});
test('reorder uses actual returned metrics', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.route('**/api/itineraries/' + id + '/items', (r) => {
    expect(r.request().postDataJSON().orderedIds).toEqual([places[1].id, places[0].id]);
    return json(r, {
      itinerary: {
        ...itinerary,
        places: [places[1], places[0]],
        distanceMeters: 360,
        walkingMinutes: 6,
      },
    });
  });
  await page.goto('/itineraries/' + id);
  await page.getByRole('button', { name: 'Xuống dưới', exact: true }).first().click();
  await expect(page.locator('.itin-edit__summary')).toContainText('360');
});
