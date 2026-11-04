// UC16: notification centre, unread badge (polling) and the tour moderation history.
import { test, expect } from '@playwright/test';
import { id, secondId, json, signIn, fixtures, noOverflow } from './fixtures.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const rejected = {
  id: 'n-ai',
  type: 'tour.ai_rejected',
  tourId: id,
  title: 'Tour «Chuyện phố cổ» không qua kiểm duyệt tự động',
  body: 'Mô tả có nội dung quảng cáo',
  data: { reasons: [{ field: 'description', category: 'scam', message: 'Mô tả chứa số điện thoại bán hàng' }] },
  read: false,
  createdAt: minutesAgo(5),
};
const approved = {
  id: 'n-ok',
  type: 'tour.approved',
  tourId: secondId,
  title: 'Tour «Tour đang công khai» đã được duyệt',
  body: null,
  data: {},
  read: true,
  createdAt: minutesAgo(60 * 3),
};
const changes = {
  id: 'n-change',
  type: 'tour.changes_requested',
  tourId: id,
  title: 'Tour «Chuyện phố cổ» cần chỉnh sửa',
  body: 'Thêm ảnh cho điểm dừng thứ hai',
  data: {},
  read: true,
  createdAt: minutesAgo(60 * 24 * 2),
};
const account = {
  id: 'n-acc',
  type: 'account.notice',
  tourId: null,
  title: 'Tài khoản của bạn vừa được cập nhật',
  body: null,
  data: {},
  read: false,
  createdAt: minutesAgo(30),
};

/** Mocks /api/notifications*; `handlers` override single endpoints. Items stay newest first. */
async function mockNotifications(page, items, handlers = {}) {
  const state = { items: items.map((n) => ({ ...n })), calls: [], count: null };
  const unreadOf = () => state.items.filter((n) => !n.read).length;
  await fixtures(page);
  await page.route('**/api/notifications**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname;
    const method = req.method();
    state.calls.push(`${method} ${path}${u.search}`);
    if (method === 'GET' && path === '/api/notifications/unread-count') {
      if (handlers.count) return handlers.count(route, state);
      return json(route, { unread: state.count ?? unreadOf() });
    }
    if (method === 'GET' && path === '/api/notifications') {
      if (handlers.list) return handlers.list(route, state, u);
      const pageNo = Number(u.searchParams.get('page') || 1);
      const limit = Number(u.searchParams.get('limit') || 20);
      const filtered = u.searchParams.get('unread') === 'true' ? state.items.filter((n) => !n.read) : state.items;
      return json(route, {
        items: filtered.slice((pageNo - 1) * limit, pageNo * limit),
        page: pageNo,
        limit,
        total: filtered.length,
        unread: unreadOf(),
      });
    }
    if (method === 'POST' && path === '/api/notifications/read-all') {
      if (handlers.readAll) return handlers.readAll(route, state);
      const updated = unreadOf();
      state.items.forEach((n) => (n.read = true));
      return json(route, { updated });
    }
    const m = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (method === 'POST' && m) {
      const nid = decodeURIComponent(m[1]);
      if (handlers.read) return handlers.read(route, state, nid);
      const n = state.items.find((x) => x.id === nid);
      if (!n) return json(route, { code: 'notification_not_found', error: 'Không tìm thấy thông báo' }, 404);
      n.read = true;
      return route.fulfill({ status: 204 });
    }
    return json(route, { error: 'unexpected' }, 404);
  });
  return state;
}

const rows = (page) => page.getByTestId('notification');
const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const accountTab = (page) => page.locator('.tabbar').getByRole('link', { name: /^Tài khoản/ });
const tabBadge = (page) => page.locator('.tabbar .notif-badge');

test('list: newest first, reasons, unread style, paging and no overflow at 390 px', async ({ page }) => {
  await signIn(page);
  const many = Array.from({ length: 22 }, (_, i) => ({
    ...approved,
    id: `old-${i}`,
    title: `Thông báo cũ ${i + 1}`,
    createdAt: minutesAgo(60 * 24 * (3 + i)),
  }));
  const state = await mockNotifications(page, [rejected, account, approved, ...many]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: /Thông báo/ }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(rows(page)).toHaveCount(20);
  const first = rows(page).first();
  await expect(first).toContainText(rejected.title);
  await expect(first).toContainText('Mô tả có nội dung quảng cáo');
  await expect(first).toContainText('Mô tả chứa số điện thoại bán hàng');
  await expect(first).toContainText('5 phút trước');
  await expect(first).toContainText('chưa đọc');
  await expect(first.locator('.notif--unread')).toHaveCount(1);
  await expect(rows(page).nth(2)).toContainText('3 giờ trước');
  await expect(rows(page).nth(2).locator('.notif--unread')).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Xem thêm' }).click();
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
  expect(state.calls).toContain('GET /api/notifications?page=2&limit=20');
  await noOverflow(page);
});

test('E1: empty state', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockNotifications(page, []);
  await page.goto('/notifications');
  await expect(page.getByText('Chưa có thông báo nào')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' })).toHaveCount(0);
});

test('load failure shows an error with retry', async ({ page }) => {
  await signIn(page);
  let fail = true;
  await mockNotifications(page, [rejected], {
    list: (route, st) =>
      fail ? route.abort('failed') : json(route, { items: st.items, page: 1, limit: 20, total: 1, unread: 1 }),
  });
  await page.goto('/notifications');
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('server error message is shown', async ({ page }) => {
  await signIn(page);
  await mockNotifications(page, [], {
    list: (route) => json(route, { code: 'validation_error', error: 'Tham số không hợp lệ' }, 400),
  });
  await page.goto('/notifications');
  await expect(page.getByRole('alert')).toContainText('Tham số không hợp lệ');
});

test('unread filter asks the server for unread only', async ({ page }) => {
  await signIn(page);
  const state = await mockNotifications(page, [rejected, account, approved, changes]);
  await page.goto('/notifications');
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('radio', { name: /Chưa đọc/ }).click();
  await expect(page.getByRole('radio', { name: /Chưa đọc/ })).toHaveAttribute('aria-checked', 'true');
  await expect(rows(page)).toHaveCount(2);
  expect(state.calls).toContain('GET /api/notifications?page=1&limit=20&unread=true');
  await page.getByRole('radio', { name: 'Tất cả' }).click();
  await expect(rows(page)).toHaveCount(4);
});

test('open a tour notification: mark read, open the Studio tour with its history', async ({ page }) => {
  await signIn(page);
  const state = await mockNotifications(page, [rejected, approved, changes]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/notifications');
  await expect(tabBadge(page)).toHaveText('1');
  await rows(page).first().getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/studio/tours/${id}$`));
  expect(state.calls).toContain(`POST /api/notifications/${rejected.id}/read`);
  await expect(tabBadge(page)).toHaveCount(0);
  // History of this tour only (the approval of another tour is filtered out).
  const history = page.locator('.tour-history');
  await expect(history).toHaveAttribute('open', '');
  await expect(history).toContainText('Lịch sử kiểm duyệt');
  await expect(history.getByTestId('notification')).toHaveCount(2);
  await expect(history).toContainText('Mô tả chứa số điện thoại bán hàng');
  await expect(history).toContainText('Thêm ảnh cho điểm dừng thứ hai');
  await expect(history).not.toContainText(approved.title);
  await noOverflow(page);
});

test('open an account notification goes to the account page; a read one sends no request', async ({ page }) => {
  await signIn(page);
  const state = await mockNotifications(page, [account, approved]);
  await page.goto('/notifications');
  await rows(page).first().getByRole('button').click();
  await expect(page).toHaveURL(/\/account$/);
  expect(state.calls).toContain(`POST /api/notifications/${account.id}/read`);
  await page.goto('/notifications');
  await rows(page).nth(1).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/studio/tours/${secondId}$`));
  expect(state.calls.filter((c) => c.endsWith('/read'))).toHaveLength(1);
});

test('mark all read', async ({ page }) => {
  await signIn(page);
  const state = await mockNotifications(page, [rejected, account, approved]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/notifications');
  await expect(tabBadge(page)).toHaveText('2');
  await page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }).click();
  await expect(toast(page, 'Đã đánh dấu 2 thông báo là đã đọc')).toBeVisible();
  await expect(page.locator('.notif--unread')).toHaveCount(0);
  await expect(tabBadge(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' })).toHaveCount(0);
  expect(state.calls).toContain('POST /api/notifications/read-all');
});

test('mark all read failure keeps the list and shows a notice', async ({ page }) => {
  await signIn(page);
  await mockNotifications(page, [rejected], { readAll: (route) => route.abort('failed') });
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }).click();
  await expect(toast(page, 'Không thể kết nối, vui lòng thử lại')).toBeVisible();
  await expect(page.locator('.notif--unread')).toHaveCount(1);
});

test('badge: count, refresh every 60 s while visible, paused while hidden, refresh on focus', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  const state = await mockNotifications(page, []);
  state.count = 3;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(tabBadge(page)).toHaveText('3');
  await expect(accountTab(page)).toHaveAccessibleName('Tài khoản, 3 thông báo chưa đọc');
  const counts = () => state.calls.filter((c) => c.startsWith('GET /api/notifications/unread-count')).length;

  state.count = 120;
  await page.clock.runFor(60_000);
  await expect(tabBadge(page)).toHaveText('99+');

  // Hidden: no polling.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = counts();
  state.count = 7;
  await page.clock.runFor(180_000);
  expect(counts()).toBe(before);
  await expect(tabBadge(page)).toHaveText('99+');

  // Visible again: refreshed at once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(tabBadge(page)).toHaveText('7');

  // Focus: refreshed.
  state.count = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(tabBadge(page)).toHaveCount(0);
  await expect(accountTab(page)).toHaveAccessibleName('Tài khoản');
});

test('desktop: bell with the count in the top bar and in the account menu', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockNotifications(page, [rejected, account]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');
  const bell = page.locator('.topnav').getByRole('link', { name: 'Thông báo, 2 thông báo chưa đọc' });
  await expect(bell).toBeVisible();
  await expect(bell).toContainText('2');
  await expect(page.locator('.menu').getByRole('link', { name: /Thông báo/ })).toContainText('2');
  await bell.click();
  await expect(page).toHaveURL(/\/notifications$/);
});

test('guest: no badge, no bell, no request; the centre needs sign-in', async ({ page }) => {
  const state = await mockNotifications(page, [rejected]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');
  await expect(page.locator('.topnav')).toContainText('Đăng nhập');
  await expect(page.locator('.notif-badge')).toHaveCount(0);
  await expect(page.locator('.topnav__bell')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Thông báo/ })).toHaveCount(0);
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/login\?next=%2Fnotifications/);
  expect(state.calls).toHaveLength(0);
});

test('Studio history: collapsed until opened, then loads; error with retry', async ({ page }) => {
  await signIn(page);
  let fail = true;
  const state = await mockNotifications(page, [rejected, approved, changes], {
    list: (route, st) =>
      fail
        ? route.abort('failed')
        : json(route, { items: st.items, page: 1, limit: 50, total: st.items.length, unread: 1 }),
  });
  await page.goto(`/studio/tours/${id}`);
  const history = page.locator('.tour-history');
  await expect(history).toContainText('Lịch sử kiểm duyệt');
  await expect(history).toContainText('Nháp');
  expect(state.calls.some((c) => c.startsWith('GET /api/notifications?'))).toBeFalsy();
  await history.locator('summary').click();
  await expect(history.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await history.getByRole('button', { name: 'Thử lại' }).click();
  await expect(history.getByTestId('notification')).toHaveCount(2);
  expect(state.calls).toContain('GET /api/notifications?page=1&limit=50');
});
