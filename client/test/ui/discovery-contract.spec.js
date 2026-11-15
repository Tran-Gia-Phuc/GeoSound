import { test, expect } from '@playwright/test';
import { id, tour, places, fixtures, json } from './fixtures.js';

for (const view of ['list', 'map']) {
  test(`filtered tabs keep their own result shape in ${view} view`, async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (error) => crashes.push(error.message));
    await fixtures(page);
    await page.route('**/api/tours?**', (r) => json(r, {
      tours: [{ ...tour, anchor: places[0] }], total: 1, page: 1,
    }));
    await page.route('**/api/places?**', (r) => json(r, { items: places, total: 2, page: 1, pageSize: 12 }));
    await page.goto(`/?tab=places&addTo=${id}&city=Hoi+An${view === 'map' ? '&view=map' : ''}`);
    await expect(page.getByRole('tab', { name: 'Địa điểm', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(view === 'map' ? '.leaflet-marker-icon' : '.place-card')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Tour', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Tour', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(view === 'map' ? '.leaflet-marker-icon' : '.tour-card')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Địa điểm', exact: true }).click();
    await expect(page.locator(view === 'map' ? '.leaflet-marker-icon' : '.place-card')).toHaveCount(2);
    expect(crashes).toEqual([]);
    await expect(page).toHaveURL(new RegExp(`addTo=${id}`));
  });
}

for (const tab of ['tours', 'places']) {
  for (const bad of [null, {}, { wrong: [] }, 'wrong', [null]]) {
    test(`${tab} rejects malformed list ${JSON.stringify(bad)} and retries`, async ({ page }) => {
      await fixtures(page);
      let invalid = true;
      const field = tab === 'tours' ? 'tours' : 'items';
      const data = tab === 'tours' ? [tour] : places;
      await page.route(`**/api/${tab === 'tours' ? 'tours' : 'places'}?**`, (r) =>
        json(r, invalid ? { [field]: bad, total: 2, page: 1 } : { [field]: data, total: data.length, page: 1 }));
      await page.goto(`/?tab=${tab}&city=Hue`);
      await expect(page.getByRole('alert')).toContainText('Dữ liệu tìm kiếm không hợp lệ');
      await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
      invalid = false;
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await expect(page.locator(tab === 'tours' ? '.tour-card' : '.place-card')).toHaveCount(data.length);
    });
  }
}

test('late pagination cannot overwrite a new tab and double clicks send one request', async ({ page }) => {
  await fixtures(page);
  let pending, release, count = 0;
  await page.route('**/api/places?**', async (r) => {
    if (new URL(r.request().url()).searchParams.get('page') === '2') {
      count++;
      pending = r;
      await new Promise((resolve) => { release = resolve; });
    } else return json(r, { items: places, total: 4, page: 1 });
  });
  await page.goto('/?tab=places&city=Hue');
  await expect(page.locator('.place-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Xem thêm', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await expect.poll(() => count).toBe(1);
  await page.getByRole('tab', { name: 'Tour', exact: true }).click();
  await expect(page.locator('.tour-card')).toHaveCount(1);
  await json(pending, { items: places, total: 4, page: 2 });
  release();
  await expect(page.locator('.tour-card')).toHaveCount(1);
  await expect(page.locator('.place-card')).toHaveCount(0);
  expect(count).toBe(1);
});

test('out-of-order filters only render the active query', async ({ page }) => {
  await fixtures(page);
  let old, release;
  await page.route('**/api/tours?**', async (r) => {
    if (new URL(r.request().url()).searchParams.get('city') === 'Old') {
      old = r;
      await new Promise((resolve) => { release = resolve; });
    } else return json(r, { tours: [{ ...tour, title: 'Current tour' }], total: 1, page: 1 });
  });
  await page.goto('/?city=Old');
  await expect.poll(() => !!old).toBe(true);
  await page.getByRole('region', { name: 'Bộ lọc khám phá' }).getByLabel('Thành phố', { exact: true }).fill('New');
  await expect(page.locator('.tour-card')).toContainText('Current tour');
  await json(old, { tours: [{ ...tour, title: 'Obsolete tour' }], total: 1, page: 1 });
  release();
  await expect(page.locator('.tour-card')).toContainText('Current tour');
  await expect(page.getByText('Obsolete tour')).toHaveCount(0);
});

test('invalid recent history and optional place images do not crash discovery', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => localStorage.setItem('geosound:recent-tours', JSON.stringify('not an array')));
  await page.goto('/');
  await expect(page.locator('.tour-card')).toHaveCount(1);
  await page.route('**/api/places?**', (r) => json(r, {
    items: [{ ...places[0], images: [null, {}, { url: null }] }], total: 1, page: 1,
  }));
  await page.getByRole('tab', { name: 'Địa điểm', exact: true }).click();
  await page.locator('.place-card__open').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('missing map coordinates are omitted without crashing', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/places?**', (r) => json(r, {
    items: [{ ...places[0], lng: undefined }], total: 1, page: 1,
  }));
  await page.goto('/?tab=places&view=map');
  await expect(page.locator('.discovermap')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xem dạng danh sách' }).click();
  await expect(page.locator('.place-card')).toHaveCount(1);
});

for (const tab of ['tours', 'places']) {
  test(`${tab} handles missing payload and invalid pagination metadata`, async ({ page }) => {
    await fixtures(page);
    const field = tab === 'tours' ? 'tours' : 'items';
    const data = tab === 'tours' ? [tour] : places;
    const invalidBodies = [null, {}, { [field]: data, page: 1 },
      { [field]: data, total: 1, page: '1' }, { [field]: data, total: -1, page: 1 },
      { [field]: [{}], total: 1, page: 1 }];
    let index = 0;
    await page.route(`**/api/${tab === 'tours' ? 'tours' : 'places'}?**`, (r) =>
      json(r, index < invalidBodies.length ? invalidBodies[index] : { [field]: data, total: data.length, page: 1 }));
    await page.goto(`/?tab=${tab}&city=Hue`);
    for (; index < invalidBodies.length;) {
      await expect(page.getByRole('alert')).toContainText('Dữ liệu tìm kiếm không hợp lệ');
      const response = page.waitForResponse((r) => r.url().includes('/api/' + (tab === 'tours' ? 'tours' : 'places')));
      index++;
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await response;
    }
    await expect(page.locator(tab === 'tours' ? '.tour-card' : '.place-card')).toHaveCount(data.length);
  });

  test(`${tab} keeps loaded items when pagination is malformed and retries page two`, async ({ page }) => {
    await fixtures(page);
    const field = tab === 'tours' ? 'tours' : 'items';
    const data = tab === 'tours' ? [tour] : [places[0]];
    const next = tab === 'tours' ? [{ ...tour, id: places[1].id, title: 'Next tour' }] : [places[1]];
    let invalid = true;
    const requested = [];
    await page.route(`**/api/${tab === 'tours' ? 'tours' : 'places'}?**`, (r) => {
      const num = Number(new URL(r.request().url()).searchParams.get('page') || 1);
      if (num === 2) requested.push(num);
      return json(r, { [field]: num === 1 ? data : invalid ? null : next, total: 2, page: num });
    });
    await page.goto(`/?tab=${tab}&city=Hue`);
    const cards = page.locator(tab === 'tours' ? '.tour-card' : '.place-card');
    await expect(cards).toHaveCount(1);
    await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Dữ liệu tìm kiếm không hợp lệ');
    await expect(cards).toHaveCount(1);
    invalid = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(cards).toHaveCount(2);
    expect(requested).toEqual([2, 2]);
  });
}

test('popular and nearby malformed responses have recoverable errors, not empty success', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 16.46, longitude: 107.59 });
  await fixtures(page);
  let invalid = true;
  await page.route('**/api/tours?**', (r) => json(r,
    invalid ? { tours: null, total: 1, page: 1 } : { tours: [tour], total: 1, page: 1 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(page.getByText('Chưa có tour nào gần bạn', { exact: false })).toHaveCount(0);
  invalid = false;
  await page.getByRole('button', { name: 'Thử lại tour gần bạn', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.tour-card')).toHaveCount(2);
});

test('direct add-to URL, empty lists, list/map and browser history remain usable', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/?addTo=${id}&city=H%E1%BB%99i+An`);
  await expect(page.locator('.tour-card')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Địa điểm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Không tìm thấy địa điểm phù hợp' })).toBeVisible();
  await page.getByRole('button', { name: 'Xem trên bản đồ' }).click();
  await expect(page.locator('.discovermap')).toBeVisible();
  await page.reload();
  await expect(page.locator('.discovermap')).toBeVisible();
  await page.getByRole('link', { name: 'Xong', exact: true }).click();
  await page.goBack();
  await expect(page.locator('.discovermap')).toBeVisible();
  await page.getByRole('button', { name: 'Xem dạng danh sách' }).click();
  await expect(page.getByRole('heading', { name: 'Không tìm thấy địa điểm phù hợp' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`addTo=${id}`));
});
