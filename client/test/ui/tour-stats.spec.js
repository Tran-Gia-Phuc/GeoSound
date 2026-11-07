// UC17 (#271): statistics beacons (view / play / complete) and the Studio statistics screen (#117).
import { test, expect } from '@playwright/test';
import { id, secondId, places, tour, json, signIn, fixtures, noOverflow } from './fixtures.js';

const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = isoDay(Date.now());
const daysAgo = (n) => isoDay(Date.parse(`${today}T00:00:00Z`) - n * DAY);
const DEVICE = 'test-device-0001';

/** Records every POST /api/tours/:id/activity (body + whether a token was sent). */
async function captureBeacons(page) {
  const beacons = [];
  await page.route('**/api/tours/*/activity', (route) => {
    const req = route.request();
    beacons.push({ path: new URL(req.url()).pathname, body: req.postDataJSON(), auth: !!req.headers().authorization });
    return route.fulfill({ status: 204 });
  });
  return beacons;
}
const withDevice = (page) =>
  page.addInitScript((d) => localStorage.setItem('geosound.deviceId', d), DEVICE);

const stats = (extra = {}) => ({
  tourId: id,
  from: daysAgo(29),
  to: today,
  language: null,
  totals: { views: 11, plays: 4, completions: 2, downloads: 1, completionRate: 0.5 },
  daily: [
    { day: daysAgo(1), views: 3, plays: 1, completions: 0, downloads: 0 },
    { day: today, views: 8, plays: 3, completions: 2, downloads: 1 },
  ],
  ratings: { averageRating: 4.6, ratingCount: 128, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 } },
  comments: {
    items: [{ id: 'c1', userName: 'An', stars: 5, comment: 'Rất hay, giọng đọc rõ', createdAt: '2026-11-03T03:00:00.000Z' }],
    total: 1,
  },
  ...extra,
});

/** Mocks GET /api/tours/mine/:id/stats; `respond` overrides the answer. */
async function mockStats(page, respond) {
  const calls = [];
  await page.route('**/api/tours/mine/*/stats**', (route) => {
    const u = new URL(route.request().url());
    calls.push(Object.fromEntries(u.searchParams));
    if (respond) return respond(route, calls.length, u);
    const body = stats({ from: u.searchParams.get('from'), to: u.searchParams.get('to') });
    return json(route, body);
  });
  return calls;
}

test.describe('beacons', () => {
  test('guest opening a public tour sends one view with language and device id, no token', async ({ page }) => {
    await withDevice(page);
    await fixtures(page);
    const beacons = await captureBeacons(page);
    await page.goto('/tour/' + id);
    await expect(page.getByRole('heading', { name: tour.title, exact: true })).toBeVisible();
    await expect.poll(() => beacons.length).toBe(1);
    expect(beacons[0]).toEqual({
      path: `/api/tours/${id}/activity`,
      body: { action: 'view', deviceId: DEVICE, language: 'vi' },
      auth: false,
    });
    // Changing the language is not a second view.
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page).toHaveURL(/lang=en/);
    await page.waitForTimeout(300);
    expect(beacons.filter((b) => b.body.action === 'view')).toHaveLength(1);
  });

  test('signed-in view sends the token and still the device id', async ({ page }) => {
    await signIn(page, 'tourist', '77777777-7777-4777-8777-777777777777');
    await withDevice(page);
    await fixtures(page);
    const beacons = await captureBeacons(page);
    await page.goto('/tour/' + id + '?lang=en');
    await expect.poll(() => beacons.length).toBe(1);
    expect(beacons[0].auth).toBe(true);
    expect(beacons[0].body).toEqual({ action: 'view', deviceId: DEVICE, language: 'en' });
  });

  test('restricted detail and Studio preview send nothing', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    await page.route('**/api/tours/' + id + '/restricted**', (route) => json(route, { tour: { ...tour, status: 'restricted' } }));
    const beacons = await captureBeacons(page);
    await page.addInitScript(() => {
      window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(new Event('end')), 50);
    });
    await page.goto('/tour/' + id + '/restricted');
    await expect(page.getByRole('heading', { name: tour.title, exact: true })).toBeVisible();
    await page.goto('/studio/tours/' + id + '/preview?mode=remote&stop=' + secondId);
    await expect(page.locator('.sheet__title')).toHaveText(places[0].name);
    await page.waitForTimeout(800);
    expect(beacons).toEqual([]);
  });

  test('public player sends play when the first stop starts and complete after the last', async ({ page }) => {
    await withDevice(page);
    await fixtures(page);
    const beacons = await captureBeacons(page);
    await page.addInitScript(
      ({ tourId, first }) => {
        localStorage.setItem('geosound:progress:' + tourId, JSON.stringify({ visited: [first], lastPlaceId: first, lang: 'vi' }));
        window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(new Event('end')), 50);
      },
      { tourId: id, first: places[0].id },
    );
    await page.goto('/tour/' + id + '/play?mode=remote&stop=' + places[1].id);
    await expect(page.getByRole('dialog', { name: 'Hoàn thành tour' })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => beacons.map((b) => b.body.action)).toEqual(['play', 'complete']);
    for (const b of beacons) expect(b.body).toMatchObject({ deviceId: DEVICE, language: 'vi' });
  });
});

test.describe('statistics screen', () => {
  test('Studio entry opens the screen with tiles, chart, ratings and comments; fits 390 px', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    const calls = await mockStats(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/studio/tours/' + id);
    await page.getByRole('link', { name: 'Thống kê' }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/tours/${id}/stats$`));
    await expect(page.getByTestId('tile-views')).toContainText('11');
    await expect(page.getByTestId('tile-plays')).toContainText('4');
    await expect(page.getByTestId('tile-completions')).toContainText('2');
    await expect(page.getByTestId('tile-rate')).toContainText('50%');
    await expect(page.getByTestId('tile-downloads')).toContainText('1');
    // One bar per day of the 30-day period, days without data are 0.
    await expect(page.getByTestId('stats-bar')).toHaveCount(30);
    const [d, mo, y] = [today.slice(8, 10), today.slice(5, 7), today.slice(0, 4)];
    await expect(page.getByRole('listitem', { name: `${d}/${mo}/${y}: 8 lượt xem` })).toBeVisible();
    await page.getByRole('button', { name: 'Lượt nghe' }).click();
    await expect(page.getByRole('listitem', { name: `${d}/${mo}/${y}: 3 lượt nghe` })).toBeVisible();
    await expect(page.getByTestId('stats-rating')).toContainText('4,6');
    await expect(page.getByTestId('stats-rating')).toContainText('128 lượt đánh giá');
    await expect(page.getByRole('listitem', { name: '5 sao: 1 lượt' })).toBeVisible();
    await expect(page.getByTestId('stats-comment')).toContainText('Rất hay, giọng đọc rõ');
    expect(calls[0]).toEqual({ from: daysAgo(29), to: today });
    await noOverflow(page);
  });

  test('filters go to the URL and change the request', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    const calls = await mockStats(page);
    await page.goto('/studio/tours/' + id + '/stats');
    await expect(page.getByTestId('tile-views')).toBeVisible();

    await page.getByRole('button', { name: '7 ngày' }).click();
    await expect(page).toHaveURL(/period=7/);
    await expect.poll(() => calls.at(-1)).toEqual({ from: daysAgo(6), to: today });
    await expect(page.getByTestId('stats-bar')).toHaveCount(7);

    await page.getByLabel('Ngôn ngữ').selectOption('en');
    await expect(page).toHaveURL(/language=en/);
    await expect.poll(() => calls.at(-1)).toEqual({ from: daysAgo(6), to: today, language: 'en' });

    await page.getByRole('button', { name: 'Tuỳ chọn' }).click();
    await page.getByLabel('Từ ngày').fill('2026-10-01');
    await page.getByLabel('Đến ngày').fill('2026-10-10');
    await expect.poll(() => calls.at(-1)).toEqual({ from: '2026-10-01', to: '2026-10-10', language: 'en' });
    await expect(page).toHaveURL(/period=custom/);
    await expect(page.getByTestId('stats-bar')).toHaveCount(10);

    // A reversed range is caught without a request.
    const before = calls.length;
    await page.getByLabel('Từ ngày').fill('2026-10-20');
    await expect(page.getByRole('alert').filter({ hasText: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc' })).toBeVisible();
    expect(calls.length).toBe(before);

    // The URL alone restores the filters.
    await page.goto(`/studio/tours/${id}/stats?period=90&language=vi`);
    await expect.poll(() => calls.at(-1)).toEqual({ from: daysAgo(89), to: today, language: 'vi' });
    await expect(page.getByRole('button', { name: '90 ngày' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('E1: everything zero shows "Chưa có dữ liệu thống kê"', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    await mockStats(page, (route) =>
      json(route, stats({
        totals: { views: 0, plays: 0, completions: 0, downloads: 0, completionRate: 0 },
        daily: [],
        ratings: { averageRating: 0, ratingCount: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
        comments: { items: [], total: 0 },
      })),
    );
    await page.goto('/studio/tours/' + id + '/stats');
    await expect(page.getByRole('heading', { name: 'Chưa có dữ liệu thống kê' })).toBeVisible();
    await expect(page.getByTestId('tile-views')).toHaveCount(0);
    await expect(page.getByText('Chưa có nhận xét.')).toBeVisible();
  });

  test('error shows the API message and "Thử lại" reloads', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    let fail = true;
    await mockStats(page, (route, n, u) =>
      fail ? json(route, { error: 'Máy chủ đang bận' }, 500) : json(route, stats({ from: u.searchParams.get('from'), to: u.searchParams.get('to') })),
    );
    await page.goto('/studio/tours/' + id + '/stats');
    const alert = page.getByRole('alert').filter({ hasText: 'Máy chủ đang bận' });
    await expect(alert).toBeVisible();
    fail = false;
    await alert.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByTestId('tile-views')).toContainText('11');
  });

  test('403 not_tour_owner shows the message without retry', async ({ page }) => {
    await signIn(page);
    await fixtures(page);
    await mockStats(page, (route) =>
      json(route, { error: 'Bạn không phải tác giả của tour này', code: 'not_tour_owner' }, 403),
    );
    await page.goto('/studio/tours/' + id + '/stats');
    const alert = page.getByRole('alert').filter({ hasText: 'Bạn không phải tác giả của tour này' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  });
});
