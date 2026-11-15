import { test, expect } from '@playwright/test';

test('live filtered discovery switches tabs with itinerary context on desktop and phone', async ({ page }) => {
  test.skip(!process.env.LIVE_API_TESTS, 'Requires the running gateway; public reads only');
  const city = encodeURIComponent('Hội An');
  const toursResponse = await page.request.get(`/api/tours?city=${city}&sort=popular&page=1&limit=12`);
  const placesResponse = await page.request.get(`/api/places?city=${city}&page=1&pageSize=12`);
  expect(toursResponse.ok()).toBe(true);
  expect(placesResponse.ok()).toBe(true);
  const tours = await toursResponse.json();
  const places = await placesResponse.json();
  expect(Array.isArray(tours.tours)).toBe(true);
  expect(Array.isArray(places.items)).toBe(true);
  const crashes = [];
  page.on('pageerror', (error) => crashes.push(error.message));

  // Only use the addTo URL context; never issue an itinerary write.
  const target = '07f9098f-a73e-4acb-a338-1afa4e35bc8c';
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?addTo=${target}&city=${city}`);
    await expect(page.locator('.skel-card')).toHaveCount(0);
    await expect(page.locator('.tour-card')).toHaveCount(tours.tours.length);
    await page.getByRole('tab', { name: 'Địa điểm', exact: true }).click();
    await expect(page.locator('.place-card')).toHaveCount(places.items.length);
    await page.getByRole('tab', { name: 'Tour', exact: true }).click();
    await expect(page.locator('.tour-card')).toHaveCount(tours.tours.length);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`addTo=${target}`));
    await page.screenshot({ path: test.info().outputPath(`live-discovery-${width}.png`), fullPage: true });
  }
  expect(crashes).toEqual([]);
});
