// UC03 offline tours (#103 download, #104 pause/resume, #158 library, #159 delete one language,
// #160 empty library, #161 insufficient storage). Every API and media request is mocked.
import { test, expect } from '@playwright/test';
import { id, places, tour, json, fixtures, noOverflow } from './fixtures.js';
import { formatBytes } from '../../src/lib/format.js';

const MEDIA = '/api/media/files';
const REV1 = '2026-11-01T00:00:00.000Z';
const REV2 = '2026-11-07T00:00:00.000Z';
const SIZES = { 'cover.png': 20000, 'p1.png': 30000, 'p1-vi.mp3': 50000, 'p2-en.mp3': 70000 };
// 1x1 PNG, padded with zeros to the wanted size (browsers ignore bytes after IEND).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const bodyOf = (name) => {
  const b = Buffer.alloc(SIZES[name]);
  if (name.endsWith('.png')) PNG.copy(b);
  return b;
};

function detailFor(lang) {
  return {
    ...tour,
    status: undefined,
    selectedLanguage: lang,
    coverImageUrl: `${MEDIA}/cover.png`,
    places: places.map((p, i) => ({
      ...p,
      text: lang === 'en' ? `English: ${p.name}` : p.text,
      images: i === 0 ? [{ url: `${MEDIA}/p1.png` }] : [],
      audioUrl: lang === 'vi' && i === 0 ? `${MEDIA}/p1-vi.mp3` : lang === 'en' && i === 1 ? `${MEDIA}/p2-en.mp3` : null,
      audioSource: lang === 'vi' && i === 0 ? 'human' : 'tts',
    })),
  };
}
function manifest(lang, revision) {
  const detail = detailFor(lang);
  const audio = lang === 'vi' ? 'p1-vi.mp3' : 'p2-en.mp3';
  return {
    tourId: id,
    language: lang,
    revision,
    detail,
    assets: [
      { url: `${MEDIA}/cover.png`, kind: 'image' },
      { url: `${MEDIA}/p1.png`, kind: 'image', placeId: places[0].id },
      { url: `${MEDIA}/${audio}`, kind: 'audio', placeId: places[lang === 'vi' ? 0 : 1].id },
    ],
  };
}
const detailBytes = (lang) => Buffer.byteLength(JSON.stringify(detailFor(lang)));

/** Mocks the package manifest, media files (GET + HEAD) and beacons on top of fixtures(). */
async function setup(page, { revision = () => REV1, hold = {}, failOnce = new Set() } = {}) {
  const log = { get: {}, head: {}, beacons: [], manifests: 0 };
  await page.addInitScript(() => {
    window.speechSynthesis.speak = () => {};
  });
  await fixtures(page);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.endsWith('/activity')) {
      log.beacons.push(req.postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (path === `/api/tours/${id}/package`) {
      log.manifests += 1;
      return json(route, manifest(new URL(req.url()).searchParams.get('lang') || 'vi', revision()));
    }
    if (path.startsWith(`${MEDIA}/`)) {
      const name = path.slice(MEDIA.length + 1);
      const bucket = req.method() === 'HEAD' ? log.head : log.get;
      bucket[name] = (bucket[name] || 0) + 1;
      try {
        if (req.method() === 'GET' && hold[name]) await hold[name];
        if (req.method() === 'GET' && failOnce.has(name)) {
          failOnce.delete(name);
          return await route.fulfill({ status: 500, body: 'boom' });
        }
        await route.fulfill({
          status: 200,
          headers: { 'content-type': name.endsWith('.png') ? 'image/png' : 'audio/mpeg', 'content-length': String(SIZES[name]) },
          body: bodyOf(name),
        });
      } catch {
        /* the browser aborted the request (pause, cancel, reload) */
      }
      return undefined;
    }
    return route.fallback();
  });
  return log;
}

function gate() {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
}

const section = (page) => page.getByRole('region', { name: 'Tải về để nghe offline' });
const downloads = (log) => log.beacons.filter((b) => b.action === 'download');

test('download, library with real sizes, new revision, offline playback from local data, beacon once (390 px)', async ({ page, context }) => {
  let revision = REV1;
  const log = await setup(page, { revision: () => revision });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id);

  const box = section(page);
  await expect(box.getByRole('checkbox', { name: 'Tiếng Việt' })).toBeChecked();
  await expect(box.getByRole('checkbox', { name: 'English' })).not.toBeChecked();
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  await expect(page.getByText('Tải tour thành công (Tiếng Việt)')).toBeVisible();
  const viBytes = SIZES['cover.png'] + SIZES['p1.png'] + SIZES['p1-vi.mp3'] + detailBytes('vi');
  await expect(box.getByText(`Đã tải · ${formatBytes(viBytes)}`)).toBeVisible();
  expect(log.get).toEqual({ 'cover.png': 1, 'p1.png': 1, 'p1-vi.mp3': 1 });
  await expect.poll(() => downloads(log).length).toBe(1);
  expect(downloads(log)[0]).toMatchObject({ action: 'download', language: 'vi' });
  await noOverflow(page);

  // Library: real size, dates, no "Có bản mới" while the server revision is the same.
  await box.getByRole('link', { name: 'Tour đã tải' }).click();
  await expect(page.getByRole('heading', { name: 'Tour đã tải' })).toBeVisible();
  const row = page.getByTestId('pkg-vi');
  await expect(row.getByText('Sẵn sàng offline')).toBeVisible();
  await expect(row.getByText(formatBytes(viBytes), { exact: true })).toBeVisible();
  await expect(page.getByText(`Đang dùng ${formatBytes(viBytes)} trên thiết bị này`)).toBeVisible();
  await expect(row.getByText('Có bản mới')).toHaveCount(0);
  await noOverflow(page);

  // Server has a newer revision -> "Có bản mới" (online only).
  revision = REV2;
  await page.reload();
  await expect(page.getByTestId('pkg-vi').getByText('Có bản mới')).toBeVisible();

  // Network off: the library and the player work from IndexedDB only.
  const offlineRequests = [];
  await context.setOffline(true);
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) offlineRequests.push(r.url());
  });
  await expect(page.getByTestId('pkg-vi').getByText('Có bản mới')).toHaveCount(0);
  await expect(page.getByText('Đang offline — vẫn nghe được các tour đã tải.')).toBeVisible();
  await page.getByTestId('pkg-vi').getByRole('link', { name: 'Nghe' }).click();
  await expect(page.locator('.topbar__name')).toHaveText(tour.title);
  await page.getByRole('list', { name: 'Danh sách điểm dừng' }).getByRole('button', { name: new RegExp(places[0].name) }).click();
  const img = page.getByRole('listitem', { name: `${places[0].name} — ảnh 1` });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(1);
  expect(offlineRequests).toEqual([]);
  await noOverflow(page);
  expect(downloads(log).length).toBe(1); // no second beacon
});

test('pause keeps stored files and resume downloads only the rest', async ({ page }) => {
  const g = gate();
  const log = await setup(page, { hold: { 'p1-vi.mp3': g.promise }, failOnce: new Set() });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  const progress = box.getByTestId('progress-vi');
  await expect(progress.getByText(/Đang tải… 2\/3 tệp/)).toBeVisible();
  await progress.getByRole('button', { name: 'Tạm dừng tải Tiếng Việt' }).click();
  await expect(progress.getByText('Đã tạm dừng. Phần đã tải được giữ lại.')).toBeVisible();
  const stored = formatBytes(SIZES['cover.png'] + SIZES['p1.png'] + detailBytes('vi'));
  await expect(progress.getByText(`2/3 tệp · đã lưu ${stored}`)).toBeVisible();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(0);
  g.release();
  await progress.getByRole('button', { name: 'Tiếp tục tải Tiếng Việt' }).click();
  await expect(box.getByText(/Đã tải ·/)).toBeVisible();
  // images were stored before the pause: not downloaded again; the cut audio was.
  expect(log.get).toEqual({ 'cover.png': 1, 'p1.png': 1, 'p1-vi.mp3': 2 });
  await expect.poll(() => downloads(log).length).toBe(1);
});

test('a failed file is reported with its reason, never marked ready, and retried', async ({ page }) => {
  const log = await setup(page, { failOnce: new Set(['p1-vi.mp3']) });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  const progress = box.getByTestId('progress-vi');
  await expect(progress.getByText('Một số tệp chưa tải được.')).toBeVisible();
  await expect(progress.getByText('Âm thanh: Lỗi máy chủ (500)')).toBeVisible();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(0);
  expect(downloads(log)).toEqual([]);
  await progress.getByRole('button', { name: 'Thử lại tải Tiếng Việt' }).click();
  await expect(box.getByText(/Đã tải ·/)).toBeVisible();
  expect(log.get['cover.png']).toBe(1);
  await expect.poll(() => downloads(log).length).toBe(1);
});

test('a reload in the middle of a download is recovered on the next visit', async ({ page }) => {
  const g = gate();
  const log = await setup(page, { hold: { 'p1-vi.mp3': g.promise } });
  await page.goto('/tour/' + id);
  await section(page).getByRole('button', { name: 'Tải xuống' }).click();
  await expect(section(page).getByText(/Đang tải… 2\/3 tệp/)).toBeVisible();
  await page.reload();
  const progress = section(page).getByTestId('progress-vi');
  await expect(progress.getByText('Bị gián đoạn. Phần đã tải được giữ lại.')).toBeVisible();
  await expect(progress.getByText(/^2\/3 tệp/)).toBeVisible();
  g.release();
  await progress.getByRole('button', { name: 'Tiếp tục tải Tiếng Việt' }).click();
  await expect(section(page).getByText(/Đã tải ·/)).toBeVisible();
  expect(log.get).toEqual({ 'cover.png': 1, 'p1.png': 1, 'p1-vi.mp3': 2 });
});

test('cancel removes the unfinished package; no network shows the connection notice', async ({ page, context }) => {
  const g = gate();
  const log = await setup(page, { hold: { 'p1-vi.mp3': g.promise } });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  await expect(box.getByText(/Đang tải… 2\/3 tệp/)).toBeVisible();
  await box.getByRole('button', { name: 'Huỷ tải Tiếng Việt' }).click();
  await expect(page.getByText('Đã huỷ tải bản Tiếng Việt')).toBeVisible();
  await expect(box.getByRole('checkbox', { name: 'Tiếng Việt' })).toBeVisible();
  g.release();
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'Chưa có tour nào được tải' })).toBeVisible();

  await page.goto('/tour/' + id);
  await context.setOffline(true);
  await section(page).getByRole('button', { name: 'Tải xuống' }).click();
  await expect(section(page).getByText('Cần kết nối mạng (Wi-Fi hoặc dữ liệu di động) để tải tour')).toBeVisible();
  expect(downloads(log)).toEqual([]);
});

test('delete one language frees only its own bytes, keeps shared images, works offline', async ({ page, context }) => {
  const log = await setup(page);
  await page.addInitScript(() => {
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (window.__deleteFail) throw new DOMException('Disk error', 'UnknownError');
      return del.call(this, key);
    };
  });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('checkbox', { name: 'English' }).check();
  await box.getByRole('button', { name: 'Tải xuống (2 ngôn ngữ)' }).click();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(2);
  // shared images are downloaded once for both languages
  expect(log.get).toEqual({ 'cover.png': 1, 'p1.png': 1, 'p1-vi.mp3': 1, 'p2-en.mp3': 1 });
  await expect.poll(() => downloads(log).map((b) => b.language).sort()).toEqual(['en', 'vi']);

  await context.setOffline(true);
  await box.getByRole('link', { name: 'Tour đã tải' }).click();
  const shared = SIZES['cover.png'] + SIZES['p1.png'];
  const total = shared + SIZES['p1-vi.mp3'] + SIZES['p2-en.mp3'] + detailBytes('vi') + detailBytes('en');
  await expect(page.getByText(`Đang dùng ${formatBytes(total)} trên thiết bị này`)).toBeVisible();

  const viFree = SIZES['p1-vi.mp3'] + detailBytes('vi');
  const del = () => page.getByRole('button', { name: `Xoá bản Tiếng Việt của ${tour.title}` }).click();
  const dialog = page.getByRole('dialog');

  // Cancel keeps every package.
  await del();
  await expect(dialog.getByText(`Sẽ giải phóng ${formatBytes(viFree)} trên thiết bị.`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Huỷ' }).click();
  await expect(page.getByTestId('pkg-vi')).toBeVisible();
  await expect(page.getByTestId('pkg-en')).toBeVisible();

  // A failed deletion keeps the package and says so.
  await page.evaluate(() => (window.__deleteFail = true));
  await del();
  await dialog.getByRole('button', { name: 'Xoá' }).click();
  await expect(page.getByText('Chưa xoá được, vui lòng thử lại')).toBeVisible();
  await expect(page.getByTestId('pkg-vi')).toBeVisible();
  await page.evaluate(() => (window.__deleteFail = false));

  // Confirm deletes only Vietnamese; English (and the shared images) stay playable.
  await del();
  await dialog.getByRole('button', { name: 'Xoá' }).click();
  await expect(page.getByText(`Đã xoá bản Tiếng Việt · giải phóng ${formatBytes(viFree)}`)).toBeVisible();
  await expect(page.getByTestId('pkg-vi')).toHaveCount(0);
  await expect(page.getByTestId('pkg-en').getByText('Sẵn sàng offline')).toBeVisible();
  await expect(page.getByText(`Đang dùng ${formatBytes(total - viFree)} trên thiết bị này`)).toBeVisible();
  await noOverflow(page);

  await page.getByTestId('pkg-en').getByRole('link', { name: 'Nghe' }).click();
  await page.getByRole('list', { name: 'Danh sách điểm dừng' }).getByRole('button', { name: new RegExp(places[0].name) }).click();
  await expect(page.getByRole('listitem', { name: `${places[0].name} — ảnh 1` })).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Thoát tour' }).click();

  // Removing the last package shows the empty state.
  await page.getByRole('button', { name: `Xoá bản English của ${tour.title}` }).click();
  await dialog.getByRole('button', { name: 'Xoá' }).click();
  await expect(page.getByRole('heading', { name: 'Chưa có tour nào được tải' })).toBeVisible();
});

test('empty library links to discovery; storage failure never shows the empty state', async ({ page, browser }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: /Tour đã tải/ }).click();
  await expect(page).toHaveURL(/\/offline$/);
  await expect(page.getByRole('heading', { name: 'Chưa có tour nào được tải' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('link', { name: 'Tìm tour' }).click();
  await expect(page).toHaveURL(/\/$/);

  const ctx = await browser.newContext();
  const broken = await ctx.newPage();
  await fixtures(broken);
  await broken.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
  });
  await broken.goto('/offline');
  await expect(broken.getByText('Không đọc được bộ nhớ trên thiết bị này. Tour đã tải chưa thể hiển thị.')).toBeVisible();
  await expect(broken.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expect(broken.getByRole('heading', { name: 'Chưa có tour nào được tải' })).toHaveCount(0);
  await ctx.close();
});

test('not enough space before the download: required and available, nothing downloaded', async ({ page }) => {
  const log = await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ quota: 100000, usage: 90000 }), persist: async () => true, persisted: async () => false },
    });
  });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  const alert = box.getByRole('alert').filter({ hasText: 'Không đủ dung lượng trên thiết bị' });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(`Cần khoảng ${formatBytes(100000)} cho bản Tiếng Việt.`)).toBeVisible();
  await expect(alert.getByText(`Còn trống khoảng ${formatBytes(10000)}.`)).toBeVisible();
  await expect(alert.getByRole('link', { name: 'Quản lý tour đã tải' })).toHaveAttribute('href', '/offline');
  expect(log.get).toEqual({});
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(0);
  expect(downloads(log)).toEqual([]);
});

test('QuotaExceededError while writing keeps completed packages, never marks ready, retry works after cleanup', async ({ page }) => {
  const log = await setup(page);
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      if (window.__quotaFail && value?.blob && String(value.url).endsWith('p1-vi.mp3')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return put.call(this, value, ...rest);
    };
  });
  await page.goto('/tour/' + id);
  const box = section(page);
  await box.getByRole('checkbox', { name: 'Tiếng Việt' }).uncheck();
  await box.getByRole('checkbox', { name: 'English' }).check();
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(1);

  await page.evaluate(() => (window.__quotaFail = true));
  await box.getByRole('checkbox', { name: 'Tiếng Việt' }).check();
  await box.getByRole('button', { name: 'Tải xuống' }).click();
  const progress = box.getByTestId('progress-vi');
  await expect(progress.getByRole('alert').filter({ hasText: 'Không đủ dung lượng trên thiết bị' })).toBeVisible();
  await expect(progress.getByText('Bản tải chưa hoàn tất. Hãy xoá bớt tour đã tải rồi thử lại.')).toBeVisible();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(1); // English stays ready, Vietnamese is not
  expect(downloads(log).map((b) => b.language)).toEqual(['en']);

  await page.evaluate(() => (window.__quotaFail = false));
  await progress.getByRole('button', { name: 'Tiếp tục tải Tiếng Việt' }).click();
  await expect(box.getByText(/Đã tải ·/)).toHaveCount(2);
  expect(log.get['cover.png']).toBe(1); // shared with English, never downloaded twice
  await expect.poll(() => downloads(log).map((b) => b.language).sort()).toEqual(['en', 'vi']);
});
