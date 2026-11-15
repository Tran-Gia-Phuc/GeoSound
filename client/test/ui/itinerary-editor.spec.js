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

test('itinerary offline: download from the editor with the account, listed as "Lịch trình", plays from local data, no beacon', async ({ page, context }) => {
  const MEDIA = '/api/media/files';
  const detail = {
    ...itinerary,
    title: itinerary.name, // the server view sets title = name
    selectedLanguage: 'vi',
    availableLanguages: ['vi'],
    places: places.map((p, i) => ({ ...p, images: [], audioUrl: i === 0 ? `${MEDIA}/it-a.mp3` : null, audioSource: i === 0 ? 'human' : 'tts' })),
  };
  const auth = [];
  const beacons = [];
  await page.addInitScript(() => {
    window.speechSynthesis.speak = () => {};
  });
  await fixtures(page);
  await signIn(page);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/activity')) {
      beacons.push(path);
      return route.fulfill({ status: 204 });
    }
    if (path === `/api/itineraries/${id}/package`) {
      auth.push(req.headers().authorization || null);
      return json(route, {
        tourId: id,
        itineraryId: id,
        kind: 'itinerary',
        language: 'vi',
        revision: '2026-11-08T00:00:00.000Z',
        detail,
        assets: [{ url: `${MEDIA}/it-a.mp3`, kind: 'audio', placeId: places[0].id }],
      });
    }
    if (path === `/api/itineraries/${id}`) return json(route, { itinerary: detail });
    if (path === `${MEDIA}/it-a.mp3`) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '4000' }, body: Buffer.alloc(4000) });
    }
    return route.fallback();
  });

  await page.goto('/itineraries/' + id);
  const box = page.getByRole('region', { name: 'Tải về để nghe offline' });
  await expect(box.getByText('Bản tải là ảnh chụp lịch trình lúc tải')).toBeVisible();
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  await expect(page.getByText('Tải tour thành công (Tiếng Việt)')).toBeVisible();
  expect(auth[0]).toBe('Bearer test-access');

  await box.getByRole('link', { name: 'Tour đã tải' }).click();
  const card = page.locator('li.offline-tour').filter({ hasText: itinerary.name });
  await expect(card.getByText('Lịch trình', { exact: true })).toBeVisible();
  await expect(card.getByTestId('pkg-vi').getByText('Sẵn sàng offline')).toBeVisible();

  await context.setOffline(true);
  await card.getByRole('link', { name: /Nghe/ }).first().click();
  await expect(page).toHaveURL(/\/offline\/itinerary%3A/);
  await expect(page.getByText(itinerary.name).first()).toBeVisible();
  await context.setOffline(false);
  expect(beacons).toHaveLength(0);
});
