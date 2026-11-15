// UC22 (#275, Frontend A #121 and #136): admin dashboard, action log and log detail.
// #299: top contributor names and avatars from the public author API.
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow, id as tourId, userId } from './fixtures.js';

const authorA = '77777777-7777-4777-8777-777777777777';
const authorB = '88888888-8888-4888-8888-888888888888';
const target = '55555555-5555-4555-8555-555555555555';
const logId = '99999999-9999-4999-8999-999999999999';
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

const dashboard = {
  from: '2026-10-28T00:00:00.000Z',
  to: '2026-11-04T00:00:00.000Z',
  pendingReview: { pending_review: 4, ai_warning: 2, total: 6 },
  averageReviewHours: 5.25,
  reportedTours: 3,
  openReportTours: 2,
  topContributors: [
    { authorId: authorA, publicTours: 5, averageRating: 4.6 },
    { authorId: authorB, publicTours: 2, averageRating: 4.2 },
  ],
  actionsByType: { approve_tour: 7, hide_tour: 2, ban_user: 1 },
};
const emptyDashboard = {
  from: dashboard.from, to: dashboard.to,
  pendingReview: { pending_review: 0, ai_warning: 0, total: 0 },
  averageReviewHours: 0, reportedTours: 0, openReportTours: 0, topContributors: [], actionsByType: {},
};
const logItems = [
  { id: logId, adminId: userId, action: 'hide_tour', targetType: 'tour', targetId: tourId, reason: 'Sai sự thật',
    data: { fromStatus: 'public', reportCount: 3 }, createdAt: hoursAgo(1) },
  { id: 'l2', adminId: userId, action: 'suspend_user', targetType: 'user', targetId: target, reason: 'Spam',
    data: { until: hoursAgo(-48) }, createdAt: hoursAgo(5) },
];

const authorProfiles = {
  [authorA]: { id: authorA, fullName: 'Nguyễn Văn A', avatarUrl: null, bio: null, followerCount: 3, joinedAt: hoursAgo(900) },
  [authorB]: { id: authorB, fullName: 'Trần Thị B', avatarUrl: null, bio: null, followerCount: 0, joinedAt: hoursAgo(900) },
};

/**
 * Mocks GET /api/auth/authors/:id (registered after fixtures(), so it wins). `handler(route, id)`
 * overrides the answer; returns the list of requested ids.
 */
async function mockAuthors(page, handler) {
  const asked = [];
  await page.route(/\/api\/auth\/authors\/[^/]+$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    asked.push(id);
    if (handler) return handler(route, id);
    return authorProfiles[id]
      ? json(route, { author: authorProfiles[id] })
      : json(route, { error: 'Không tìm thấy tác giả', code: 'author_not_found' }, 404);
  });
  return asked;
}

/** Mocks the UC22 endpoints; `handlers[key](route)` overrides one of dashboard | actions | action. */
async function mockInsights(page, handlers = {}) {
  const calls = [];
  await fixtures(page);
  await page.route(/\/api\/tours\/admin\/(dashboard|actions)/, (route) => {
    const u = new URL(route.request().url());
    const key = u.pathname.endsWith('/dashboard') ? 'dashboard' : u.pathname === '/api/tours/admin/actions' ? 'actions' : 'action';
    calls.push({ key, method: route.request().method(), path: u.pathname, params: Object.fromEntries(u.searchParams) });
    if (handlers[key]) return handlers[key](route);
    if (key === 'dashboard') return json(route, dashboard);
    if (key === 'actions') return json(route, { items: logItems, page: 1, limit: 20, total: 2 });
    return json(route, logItems[0]);
  });
  return calls;
}

test('non-admin sees a notice and no admin API is called', async ({ page }) => {
  await signIn(page, 'tourist');
  const calls = await mockInsights(page);
  for (const path of ['/admin/dashboard', '/admin/actions', `/admin/actions/${logId}`]) {
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  }
  expect(calls).toHaveLength(0);
});

test('dashboard shows the tiles, top contributors and actions by type', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockInsights(page);
  await page.goto('/admin/dashboard');
  await expect(page.getByTestId('tile-pending')).toContainText('6');
  await expect(page.getByTestId('tile-pending')).toContainText('4 chờ duyệt · 2 cảnh báo AI');
  await expect(page.getByTestId('tile-review-time')).toContainText('5,25 giờ');
  await expect(page.getByTestId('tile-reported')).toContainText('3');
  await expect(page.getByTestId('tile-open-reports')).toContainText('2');
  await expect(page.getByTestId('tile-open-reports')).toHaveAttribute('href', '/admin/reports');
  await expect(page.getByTestId('period-text')).toContainText('28/10/2026');
  await expect(page.getByTestId('period-text')).toContainText('3/11/2026');

  const top = page.getByTestId('top-contributor');
  await expect(top).toHaveCount(2);
  await expect(top.nth(0)).toContainText('5');
  await expect(top.nth(0)).toContainText('★ 4.6');
  await expect(page.getByRole('link', { name: authorA.slice(0, 8) })).toHaveAttribute('href', `/admin/users/${authorA}`);

  const bars = page.getByTestId('action-bar');
  await expect(bars).toHaveCount(3);
  await expect(bars.nth(0)).toContainText('Duyệt tour');
  await expect(bars.nth(0)).toContainText('7');
  await expect(bars.nth(1)).toContainText('Ẩn tour');
  await expect(bars.nth(2)).toContainText('Cấm tài khoản');
  expect(calls[0]).toMatchObject({ key: 'dashboard', method: 'GET', params: {} });
});

test('top contributors show the author names, one request per author, cached for the page', async ({ page }) => {
  await signIn(page, 'admin');
  await mockInsights(page);
  const asked = await mockAuthors(page);
  await page.goto('/admin/dashboard');
  const top = page.getByTestId('top-contributor');
  await expect(top.nth(0).getByTestId('contributor-name')).toHaveText('Nguyễn Văn A');
  await expect(top.nth(1).getByTestId('contributor-name')).toHaveText('Trần Thị B');
  await expect(page.getByRole('link', { name: 'Nguyễn Văn A' })).toHaveAttribute('href', `/admin/users/${authorA}`);
  await expect(page.getByRole('link', { name: 'Trần Thị B' })).toHaveAttribute('href', `/admin/users/${authorB}`);
  await expect(top.nth(0).locator('.author-avatar')).toHaveText('N');

  // Another period returns the same authors: no new profile request.
  await page.getByRole('radio', { name: '30 ngày' }).click();
  await expect(page).toHaveURL(/period=30/);
  await expect(top.nth(0).getByTestId('contributor-name')).toHaveText('Nguyễn Văn A');
  expect(asked.sort()).toEqual([authorA, authorB].sort());
});

test('the dashboard renders before the profiles, and a failed profile falls back to the short id', async ({ page }) => {
  await signIn(page, 'admin');
  await mockInsights(page);
  let release;
  const gate = new Promise((r) => (release = r));
  const asked = await mockAuthors(page, async (route, id) => {
    if (id === authorB) return route.abort('failed'); // network error
    await gate; // A stays pending until released
    return json(route, { error: 'Không tìm thấy tác giả', code: 'author_not_found' }, 404);
  });
  await page.goto('/admin/dashboard');
  const top = page.getByTestId('top-contributor');
  // Tiles and rows are there while A's profile is still loading: short ids as placeholders.
  await expect(page.getByTestId('tile-pending')).toContainText('6');
  await expect(top.nth(0).getByTestId('contributor-name')).toHaveText(authorA.slice(0, 8));
  await expect(top.nth(1).getByTestId('contributor-name')).toHaveText(authorB.slice(0, 8));
  release();
  await expect.poll(() => asked.length).toBe(2);
  await expect(top.nth(0).getByTestId('contributor-name')).toHaveText(authorA.slice(0, 8));
  await expect(page.getByRole('link', { name: authorA.slice(0, 8) })).toHaveAttribute('href', `/admin/users/${authorA}`);
  await expect(page.getByRole('link', { name: authorA.slice(0, 8) })).toHaveAttribute('title', authorA);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('action-bar')).toHaveCount(3);
});

test('period filter: 30 days and a custom range are sent as from/to and kept in the URL', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockInsights(page);
  await page.goto('/admin/dashboard');
  await expect(page.getByTestId('tile-pending')).toBeVisible();
  await page.getByRole('radio', { name: '30 ngày' }).click();
  await expect(page).toHaveURL(/period=30/);
  await expect.poll(() => Object.keys(calls.at(-1).params).sort()).toEqual(['from', 'to']);
  const { from, to } = calls.at(-1).params;
  expect((Date.parse(to) - Date.parse(from)) / 86400000).toBe(29);

  await page.getByRole('radio', { name: 'Tuỳ chọn' }).click();
  await page.getByLabel('Từ ngày').fill('2026-10-10');
  await page.getByLabel('Đến ngày').fill('2026-10-01');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page.getByRole('alert')).toContainText('Ngày bắt đầu phải trước ngày kết thúc');
  await page.getByLabel('Đến ngày').fill('2026-10-20');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page).toHaveURL(/period=custom&from=2026-10-10&to=2026-10-20/);
  await expect.poll(() => calls.at(-1).params).toEqual({ from: '2026-10-10', to: '2026-10-20' });

  await page.reload();
  await expect.poll(() => calls.at(-1).params).toEqual({ from: '2026-10-10', to: '2026-10-20' });
  await expect(page.getByRole('radio', { name: 'Tuỳ chọn' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '7 ngày' }).click();
  await expect.poll(() => calls.at(-1).params).toEqual({});
});

test('empty data shows zeros and "Chưa có dữ liệu" instead of charts', async ({ page }) => {
  await signIn(page, 'admin');
  await mockInsights(page, { dashboard: (route) => json(route, emptyDashboard) });
  await page.goto('/admin/dashboard');
  await expect(page.getByTestId('tile-pending')).toContainText('0');
  await expect(page.getByTestId('tile-review-time')).toContainText('Chưa có dữ liệu');
  await expect(page.getByRole('region', { name: 'Tác giả nổi bật' })).toContainText('Chưa có dữ liệu');
  await expect(page.getByRole('region', { name: 'Hành động quản trị theo loại' })).toContainText('Chưa có dữ liệu');
  await expect(page.getByTestId('action-bar')).toHaveCount(0);
});

test('dashboard error shows the message and "Thử lại" reloads', async ({ page }) => {
  await signIn(page, 'admin');
  let fail = true;
  await mockInsights(page, {
    dashboard: (route) => (fail ? json(route, { error: 'Khoảng thời gian không hợp lệ' }, 400) : json(route, dashboard)),
  });
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('alert')).toContainText('Khoảng thời gian không hợp lệ');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByTestId('tile-pending')).toContainText('6');
});

test('action log lists rows with target links and sends the filters', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockInsights(page);
  await page.goto('/admin/actions');
  const rows = page.getByTestId('log-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Ẩn tour');
  await expect(rows.nth(0)).toContainText('Sai sự thật');
  await expect(rows.nth(0)).toContainText(userId);
  await expect(rows.nth(0).getByRole('link', { name: `Tour ${tourId}` })).toHaveAttribute('href', `/admin/reports/${tourId}`);
  await expect(rows.nth(1).getByRole('link', { name: `Tài khoản ${target}` })).toHaveAttribute('href', `/admin/users/${target}`);
  expect(calls[0].params).toEqual({ page: '1', limit: '20' });

  await page.getByLabel('Loại hành động').selectOption('ban_user');
  await page.getByLabel('Đối tượng').selectOption('user');
  await page.getByLabel('Mã quản trị viên').fill(` ${userId} `);
  await page.getByLabel('Từ ngày').fill('2026-10-01');
  await page.getByLabel('Đến ngày').fill('2026-10-31');
  await page.getByRole('button', { name: 'Lọc' }).click();
  await expect.poll(() => calls.at(-1).params).toEqual({
    action: 'ban_user', targetType: 'user', adminId: userId, from: '2026-10-01', to: '2026-10-31', page: '1', limit: '20',
  });
  await expect(page).toHaveURL(/action=ban_user/);
  await page.reload();
  await expect(page.getByLabel('Loại hành động')).toHaveValue('ban_user');
  await page.getByRole('button', { name: 'Xoá bộ lọc' }).click();
  await expect.poll(() => calls.at(-1).params).toEqual({ page: '1', limit: '20' });
});

test('action log pages, shows empty and error states', async ({ page }) => {
  await signIn(page, 'admin');
  let mode = 'many';
  const calls = await mockInsights(page, {
    actions: (route) =>
      mode === 'many'
        ? json(route, { items: logItems, page: 1, limit: 20, total: 41 })
        : mode === 'empty'
          ? json(route, { items: [], page: 1, limit: 20, total: 0 })
          : json(route, { error: 'Máy chủ đang bận' }, 500),
  });
  await page.goto('/admin/actions?targetType=tour');
  await expect(page.getByText('Trang 1/3')).toBeVisible();
  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect(page.getByText('Trang 2/3')).toBeVisible();
  expect(calls.at(-1).params).toEqual({ targetType: 'tour', page: '2', limit: '20' });

  mode = 'error';
  await page.goto('/admin/actions');
  await expect(page.getByRole('alert')).toContainText('Máy chủ đang bận');
  mode = 'empty';
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Chưa có hành động nào')).toBeVisible();
});

test('log detail is read-only and shows data as labelled fields', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockInsights(page);
  await page.goto('/admin/actions');
  await page.getByTestId('log-row').nth(0).getByRole('link', { name: /Chi tiết/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/actions/${logId}$`));
  const card = page.getByRole('region', { name: 'Bản ghi nhật ký' });
  await expect(card).toContainText('Ẩn tour');
  await expect(card).toContainText('Nhật ký không thể sửa hoặc xoá');
  await expect(card).toContainText('Sai sự thật');
  await expect(card.getByRole('link', { name: `Tour ${tourId}` })).toHaveAttribute('href', `/admin/reports/${tourId}`);
  const data = page.getByTestId('action-data');
  await expect(data).toHaveCount(2);
  await expect(data.nth(0)).toContainText('Trạng thái trước');
  await expect(data.nth(0)).toContainText('Công khai');
  await expect(data.nth(1)).toContainText('Số báo cáo được đóng');
  await expect(data.nth(1)).toContainText('3');
  await expect(card.getByRole('button')).toHaveCount(0);
  expect(calls.at(-1)).toMatchObject({ key: 'action', method: 'GET', path: `/api/tours/admin/actions/${logId}` });
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});

test('unknown log row shows "Không tìm thấy bản ghi"', async ({ page }) => {
  await signIn(page, 'admin');
  await mockInsights(page, {
    action: (route) => json(route, { error: 'Không tìm thấy bản ghi', code: 'admin_action_not_found' }, 404),
  });
  await page.goto(`/admin/actions/${logId}`);
  await expect(page.getByRole('alert')).toContainText('Không tìm thấy bản ghi');
  await expect(page.getByRole('link', { name: 'Về nhật ký' })).toBeVisible();
});

test('admin home lists the dashboard first; screens fit 390 px', async ({ page }) => {
  await signIn(page, 'admin');
  await mockInsights(page);
  await mockAuthors(page, (route, id) =>
    json(route, { author: { ...authorProfiles[id], fullName: 'Nguyễn Thị Phương Thảo Hoàng Minh Châu Anh' } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  const menu = page.getByRole('navigation', { name: 'Màn quản trị' }).getByRole('link');
  await expect(menu.first()).toContainText('Dashboard');
  await expect(page.getByRole('navigation', { name: 'Màn quản trị' }).getByRole('link', { name: /Nhật ký hành động/ })).toBeVisible();
  await menu.first().click();
  await expect(page.getByTestId('action-bar')).toHaveCount(3);
  const name = page.getByTestId('contributor-name').first();
  await expect(name).toContainText('Nguyễn Thị Phương');
  // One line per name (ellipsis), the table stays inside its card.
  const box = await name.boundingBox();
  expect(box.height).toBeLessThan(30);
  const wrap = await page.locator('.admin-table__wrap').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(wrap).toBe(true);
  await noOverflow(page);
  await page.getByRole('radio', { name: 'Tuỳ chọn' }).click();
  await noOverflow(page);
  await page.goto('/admin/actions');
  await expect(page.getByTestId('log-row')).toHaveCount(2);
  await noOverflow(page);
  await page.goto(`/admin/actions/${logId}`);
  await expect(page.getByTestId('action-data')).toHaveCount(2);
  await noOverflow(page);
});
