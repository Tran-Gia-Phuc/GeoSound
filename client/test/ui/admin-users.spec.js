// UC21 (#274, Frontend A #131 to #135): admin account search, details, violation history and actions.
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow, id as tourId, secondId, userId } from './fixtures.js';

const daysAhead = (d) => new Date(Date.now() + d * 86400000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const uid = '55555555-5555-4555-8555-555555555555';
const otherAdmin = '66666666-6666-4666-8666-666666666666';

const account = (over = {}) => ({
  id: uid, email: 'an@example.test', fullName: 'Nguyễn An', role: 'contributor', status: 'active',
  banReason: null, suspendedUntil: null, createdAt: hoursAgo(500), activeSessions: 2, ...over,
});
const items = [
  account(),
  account({ id: 'u2', email: 'binh@example.test', fullName: 'Trần Bình', role: 'tourist', status: 'suspended', banReason: 'Spam', suspendedUntil: daysAhead(3) }),
  account({ id: 'u3', email: 'cuong@example.test', fullName: 'Lê Cường', status: 'banned', banReason: 'Lừa đảo' }),
];
const violations = {
  userId: uid,
  tours: { total: 5, public: 2, hidden: 2, rejected: 1 },
  hiddenTours: [{ id: tourId, title: 'Tour bị ẩn', hiddenAt: hoursAgo(10), reason: 'Sai sự thật' }],
  rejectedTours: [{ id: secondId, title: 'Tour bị từ chối', rejectedAt: hoursAgo(40), reason: 'Nội dung không phù hợp' }],
  reports: { open: 1, dismissed: 4, actioned: 3 },
  accountActions: [
    { id: 'a1', adminId: userId, action: 'suspend_user', targetType: 'user', targetId: uid, reason: 'Đăng spam',
      data: { until: daysAhead(-2) }, createdAt: hoursAgo(200) },
    { id: 'a2', adminId: userId, action: 'warn_user', targetType: 'user', targetId: uid, reason: 'Nhắc nhở lần 1',
      data: {}, createdAt: hoursAgo(300) },
  ],
};

/** Mocks Auth admin users + Tour violations; `handlers[key](route, body)` overrides one call. */
async function mockUsers(page, handlers = {}) {
  const calls = [];
  await fixtures(page);
  const record = (key, route) => {
    const req = route.request();
    const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    calls.push({ key, method: req.method(), path: u.pathname, params: Object.fromEntries(u.searchParams), body });
    return body;
  };
  await page.route('**/api/auth/admin/users**', (route) => {
    const tail = new URL(route.request().url()).pathname.replace('/api/auth/admin/users', '');
    const key = tail === '' || tail === '/' ? 'search' : tail.split('/')[2] || 'detail';
    const body = record(key, route);
    if (handlers[key]) return handlers[key](route, body);
    if (key === 'search') return json(route, { items, total: items.length, page: 1, limit: 20 });
    if (key === 'detail') return json(route, account());
    return json(route, { message: 'OK', action: key, user: account() });
  });
  await page.route('**/api/tours/admin/users/*/violations', (route) => {
    record('violations', route);
    return handlers.violations ? handlers.violations(route) : json(route, violations);
  });
  return calls;
}

const dialog = (page) => page.getByRole('dialog');

test('non-admin sees a notice and no admin API is called', async ({ page }) => {
  await signIn(page, 'contributor');
  const calls = await mockUsers(page);
  await page.goto('/admin/users');
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  await page.goto(`/admin/users/${uid}`);
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  expect(calls).toHaveLength(0);
});

test('search lists accounts with status chips and sends q, role and status filters', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page);
  await page.goto('/admin/users');
  const rows = page.getByTestId('user-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Nguyễn An');
  await expect(rows.nth(0)).toContainText('Đang hoạt động');
  await expect(rows.nth(1)).toContainText('Tạm khoá');
  await expect(rows.nth(1)).toContainText('Tạm khoá đến');
  await expect(rows.nth(2)).toContainText('Bị cấm');
  expect(calls[0].params).toEqual({ page: '1', limit: '20' });

  await page.getByLabel('Email hoặc họ tên').fill('  an@ ');
  await page.getByRole('button', { name: 'Tìm' }).click();
  await expect.poll(() => calls.at(-1).params).toEqual({ q: 'an@', page: '1', limit: '20' });
  await page.getByLabel('Vai trò').selectOption('contributor');
  await expect.poll(() => calls.at(-1).params).toEqual({ q: 'an@', role: 'contributor', page: '1', limit: '20' });
  await page.getByLabel('Trạng thái').selectOption('suspended');
  await expect.poll(() => calls.at(-1).params).toEqual({ q: 'an@', role: 'contributor', status: 'suspended', page: '1', limit: '20' });
  await expect(page).toHaveURL(/q=an%40&role=contributor&status=suspended/);

  await rows.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${uid}$`));
});

test('search pages through results and keeps the filters', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page, {
    search: (route) => json(route, { items, total: 45, page: 1, limit: 20 }),
  });
  await page.goto('/admin/users?role=tourist');
  await expect(page.getByText('Trang 1/3')).toBeVisible();
  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect(page.getByText('Trang 2/3')).toBeVisible();
  expect(calls.at(-1).params).toEqual({ role: 'tourist', page: '2', limit: '20' });
});

test('empty search and error with retry', async ({ page }) => {
  await signIn(page, 'admin');
  let mode = 'error';
  await mockUsers(page, {
    search: (route) =>
      mode === 'error' ? json(route, { error: 'Máy chủ đang bận' }, 500) : json(route, { items: [], total: 0, page: 1, limit: 20 }),
  });
  await page.goto('/admin/users?q=zzz');
  await expect(page.getByRole('alert')).toContainText('Máy chủ đang bận');
  mode = 'empty';
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Không có tài khoản phù hợp')).toBeVisible();
});

test('detail shows the account, sessions and violation history with links', async ({ page }) => {
  await signIn(page, 'admin');
  await mockUsers(page, {
    detail: (route) => json(route, account({ status: 'suspended', banReason: 'Đăng spam', suspendedUntil: daysAhead(5) })),
  });
  await page.goto(`/admin/users/${uid}`);
  const info = page.getByRole('region', { name: 'Thông tin tài khoản' });
  await expect(info).toContainText('Nguyễn An');
  await expect(info).toContainText('an@example.test');
  await expect(info).toContainText('Tác giả');
  await expect(info).toContainText('Tạm khoá');
  await expect(info).toContainText('Lý do: Đăng spam');
  await expect(page.getByTestId('suspended-until')).toContainText('Tạm khoá đến');
  await expect(page.getByTestId('active-sessions')).toContainText('2 thiết bị đang đăng nhập');

  const stats = page.getByTestId('violation-stat');
  await expect(stats).toHaveCount(4);
  await expect(stats.nth(0)).toContainText('5');
  await expect(stats.nth(2)).toContainText('Đang ẩn');
  await expect(stats.nth(2)).toContainText('2');
  await expect(page.getByTestId('reports-received')).toContainText('1 đang mở · 4 đã bỏ qua · 3 đã xử lý');
  await expect(page.getByRole('link', { name: 'Tour bị ẩn' })).toHaveAttribute('href', `/admin/reports/${tourId}`);
  await expect(page.getByRole('link', { name: 'Tour bị từ chối' })).toHaveAttribute('href', `/admin/reports/${secondId}`);
  const acts = page.getByTestId('account-action');
  await expect(acts).toHaveCount(2);
  await expect(acts.nth(0)).toContainText('Tạm khoá tài khoản');
  await expect(acts.nth(0)).toContainText('Đăng spam');
  await expect(acts.nth(1)).toContainText('Cảnh báo tài khoản');

  // suspended: warn, suspend, ban and restore are offered
  for (const name of ['Cảnh báo', 'Tạm khoá', 'Cấm tài khoản', 'Khôi phục']) {
    await expect(page.getByRole('region', { name: 'Xử lý tài khoản' }).getByRole('button', { name })).toBeVisible();
  }
});

test('actions follow the status: active has no restore, banned only restore', async ({ page }) => {
  await signIn(page, 'admin');
  let status = 'active';
  await mockUsers(page, { detail: (route) => json(route, account({ status, banReason: status === 'banned' ? 'Lừa đảo' : null })) });
  await page.goto(`/admin/users/${uid}`);
  const box = page.getByRole('region', { name: 'Xử lý tài khoản' });
  await expect(box.getByRole('button', { name: 'Cảnh báo' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Khôi phục' })).toHaveCount(0);
  status = 'banned';
  await page.reload();
  await expect(box.getByRole('button', { name: 'Khôi phục' })).toBeVisible();
  await expect(box.getByRole('button')).toHaveCount(1);
});

test('no actions on your own account or on another admin', async ({ page }) => {
  await signIn(page, 'admin');
  let target = account({ id: userId, role: 'admin' });
  await mockUsers(page, { detail: (route) => json(route, target) });
  await page.goto(`/admin/users/${userId}`);
  const box = page.getByRole('region', { name: 'Xử lý tài khoản' });
  await expect(box).toContainText('Đây là tài khoản của bạn');
  await expect(box.getByRole('button')).toHaveCount(0);
  target = account({ id: otherAdmin, role: 'admin' });
  await page.goto(`/admin/users/${otherAdmin}`);
  await expect(box).toContainText('Không thể xử lý tài khoản quản trị viên');
  await expect(box.getByRole('button')).toHaveCount(0);
});

test('unknown account shows "Không tìm thấy tài khoản"', async ({ page }) => {
  await signIn(page, 'admin');
  await mockUsers(page, { detail: (route) => json(route, { error: 'Không tìm thấy tài khoản', code: 'user_not_found' }, 404) });
  await page.goto(`/admin/users/${uid}`);
  await expect(page.getByRole('alert')).toContainText('Không tìm thấy tài khoản');
  await expect(page.getByRole('link', { name: 'Về danh sách' })).toBeVisible();
});

test('warn requires a reason, then posts it and reloads', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page, {
    warn: (route) => json(route, { message: 'Đã gửi cảnh báo tới tài khoản', action: 'warn', user: account() }),
  });
  await page.goto(`/admin/users/${uid}`);
  await expect(page.getByTestId('account-action')).toHaveCount(2);
  const before = calls.filter((c) => c.key === 'detail').length;
  await page.getByRole('button', { name: 'Cảnh báo' }).click();
  await dialog(page).getByRole('button', { name: 'Gửi cảnh báo' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Vui lòng nhập lý do');
  expect(calls.filter((c) => c.key === 'warn')).toHaveLength(0);
  await dialog(page).getByLabel('Lý do (bắt buộc)').fill(' Bình luận phản cảm ');
  await dialog(page).getByRole('button', { name: 'Gửi cảnh báo' }).click();
  await expect(page.getByRole('status')).toContainText('Đã gửi cảnh báo tới tài khoản');
  expect(calls.find((c) => c.key === 'warn')).toMatchObject({
    method: 'POST', path: `/api/auth/admin/users/${uid}/warn`, body: { reason: 'Bình luận phản cảm' },
  });
  await expect.poll(() => calls.filter((c) => c.key === 'detail').length).toBe(before + 1);
});

test('suspend with a preset sends days; with a date sends until (max 365 days)', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page, {
    suspend: (route) => json(route, { message: 'Đã tạm khoá tài khoản', action: 'suspend', user: account(), sessionsRevoked: 2 }),
  });
  await page.goto(`/admin/users/${uid}`);
  await page.getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(dialog(page).getByRole('radio', { name: '7 ngày' })).toHaveAttribute('aria-checked', 'true');
  await dialog(page).getByRole('radio', { name: '30 ngày' }).click();
  await dialog(page).getByLabel('Lý do (bắt buộc)').fill('Spam nhiều lần');
  await dialog(page).getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(page.getByRole('status')).toContainText('Đã tạm khoá tài khoản');
  expect(calls.find((c) => c.key === 'suspend')).toMatchObject({
    method: 'POST', path: `/api/auth/admin/users/${uid}/suspend`, body: { reason: 'Spam nhiều lần', days: 30 },
  });

  await page.getByRole('button', { name: 'Tạm khoá' }).click();
  await dialog(page).getByLabel('Lý do (bắt buộc)').fill('Spam');
  await dialog(page).getByRole('radio', { name: 'Chọn ngày' }).click();
  await dialog(page).getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Vui lòng chọn ngày kết thúc');
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await dialog(page).getByLabel('Khoá đến hết ngày').fill(local(new Date(Date.now() + 400 * 86400000)));
  await dialog(page).getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Tạm khoá tối đa 365 ngày');
  await dialog(page).getByLabel('Khoá đến hết ngày').fill(local(new Date(Date.now() - 2 * 86400000)));
  await dialog(page).getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Ngày kết thúc phải ở tương lai');
  expect(calls.filter((c) => c.key === 'suspend')).toHaveLength(1);

  const end = new Date(Date.now() + 10 * 86400000);
  await dialog(page).getByLabel('Khoá đến hết ngày').fill(local(end));
  await dialog(page).getByRole('button', { name: 'Tạm khoá' }).click();
  await expect(dialog(page)).toHaveCount(0);
  const body = calls.filter((c) => c.key === 'suspend').at(-1).body;
  expect(Object.keys(body).sort()).toEqual(['reason', 'until']);
  expect(body.until).toMatch(/Z$/);
  const until = new Date(body.until);
  expect([until.getFullYear(), until.getMonth(), until.getDate(), until.getHours(), until.getMinutes()]).toEqual([
    end.getFullYear(), end.getMonth(), end.getDate(), 23, 59,
  ]);
});

test('ban is a danger confirmation with a required reason', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page, {
    ban: (route) => json(route, { message: 'Đã cấm tài khoản', action: 'ban', user: account({ status: 'banned' }), sessionsRevoked: 1 }),
  });
  await page.goto(`/admin/users/${uid}`);
  await page.getByRole('button', { name: 'Cấm tài khoản' }).click();
  await expect(dialog(page)).toContainText('Cấm vĩnh viễn tài khoản?');
  const confirm = dialog(page).getByRole('button', { name: 'Cấm tài khoản' });
  await expect(confirm).toHaveClass(/btn--danger/);
  await confirm.click();
  await expect(dialog(page).getByRole('alert')).toContainText('Vui lòng nhập lý do');
  await dialog(page).getByLabel('Lý do (bắt buộc)').fill('Lừa đảo người dùng');
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('Đã cấm tài khoản');
  expect(calls.find((c) => c.key === 'ban')).toMatchObject({
    method: 'POST', path: `/api/auth/admin/users/${uid}/ban`, body: { reason: 'Lừa đảo người dùng' },
  });
});

test('restore sends an optional reason', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockUsers(page, {
    detail: (route) => json(route, account({ status: 'banned', banReason: 'Lừa đảo' })),
    restore: (route) => json(route, { message: 'Đã khôi phục tài khoản', action: 'restore', user: account() }),
  });
  await page.goto(`/admin/users/${uid}`);
  await page.getByRole('button', { name: 'Khôi phục' }).click();
  await dialog(page).getByRole('button', { name: 'Khôi phục' }).click();
  await expect(page.getByRole('status')).toContainText('Đã khôi phục tài khoản');
  expect(calls.find((c) => c.key === 'restore')).toMatchObject({ path: `/api/auth/admin/users/${uid}/restore`, body: {} });
  await page.getByRole('button', { name: 'Khôi phục' }).click();
  await dialog(page).getByLabel('Lý do (không bắt buộc)').fill('Đã xác minh');
  await dialog(page).getByRole('button', { name: 'Khôi phục' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(calls.filter((c) => c.key === 'restore').at(-1).body).toEqual({ reason: 'Đã xác minh' });
});

for (const [status, code, message] of [
  [409, 'account_state_changed', 'Tài khoản vừa được quản trị viên khác cập nhật'],
  [403, 'target_is_admin', 'Không thể thao tác trên tài khoản quản trị viên'],
  [404, 'user_not_found', 'Không tìm thấy tài khoản'],
]) {
  test(`an action answering ${status} ${code} shows the message and reloads`, async ({ page }) => {
    await signIn(page, 'admin');
    const calls = await mockUsers(page, { ban: (route) => json(route, { error: message, code }, status) });
    await page.goto(`/admin/users/${uid}`);
    await expect(page.getByTestId('account-action')).toHaveCount(2);
    const before = calls.filter((c) => c.key === 'detail').length;
    await page.getByRole('button', { name: 'Cấm tài khoản' }).click();
    await dialog(page).getByLabel('Lý do (bắt buộc)').fill('Spam');
    await dialog(page).getByRole('button', { name: 'Cấm tài khoản' }).click();
    await expect(page.getByTestId('user-notice')).toContainText(message);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => calls.filter((c) => c.key === 'detail').length).toBe(before + 1);
  });
}

test('a 422 is shown inside the dialog', async ({ page }) => {
  await signIn(page, 'admin');
  await mockUsers(page, { warn: (route) => json(route, { error: 'Lý do tối đa 1000 ký tự', code: 'validation_error' }, 422) });
  await page.goto(`/admin/users/${uid}`);
  await page.getByRole('button', { name: 'Cảnh báo' }).click();
  await dialog(page).getByLabel('Lý do (bắt buộc)').fill('abc');
  await dialog(page).getByRole('button', { name: 'Gửi cảnh báo' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Lý do tối đa 1000 ký tự');
});

test('violation history error has its own retry', async ({ page }) => {
  await signIn(page, 'admin');
  let fail = true;
  await mockUsers(page, {
    violations: (route) => (fail ? json(route, { error: 'Tour đang bận' }, 503) : json(route, violations)),
  });
  await page.goto(`/admin/users/${uid}`);
  const box = page.getByRole('region', { name: 'Lịch sử vi phạm' });
  await expect(box.getByRole('alert')).toContainText('Tour đang bận');
  await expect(page.getByRole('region', { name: 'Thông tin tài khoản' })).toContainText('Nguyễn An');
  fail = false;
  await box.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByTestId('account-action')).toHaveCount(2);
});

test('admin nav and the UC20 author link lead here; screens fit 390 px', async ({ page }) => {
  await signIn(page, 'admin');
  await mockUsers(page, {
    search: (route) =>
      json(route, { items: [account({ fullName: 'Một họ tên rất dài '.repeat(5), email: `${'a'.repeat(60)}@example.test` })], total: 45, page: 1, limit: 20 }),
    detail: (route) => json(route, account({ status: 'suspended', suspendedUntil: daysAhead(2), banReason: 'Lý do dài '.repeat(30) })),
  });
  await page.route('**/api/tours/admin/reports/**', (route) =>
    json(route, {
      tour: { id: tourId, title: 'Tour', description: '', status: 'public', authorId: uid, city: null, averageRating: 0, ratingCount: 0 },
      reports: { openReportCount: 0, flagged: false, flaggedAt: null, open: [], dismissedCount: 0, actionedCount: 0 },
      actions: { hide: true, restore: false, dismiss: false },
      history: [],
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByRole('navigation', { name: 'Màn quản trị' }).getByRole('link', { name: /Tài khoản/ }).click();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await noOverflow(page);
  await page.getByTestId('user-row').click();
  await expect(page.getByTestId('account-action')).toHaveCount(2);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Tạm khoá' }).click();
  await dialog(page).getByRole('radio', { name: 'Chọn ngày' }).click();
  await noOverflow(page);
  await page.keyboard.press('Escape');

  await page.goto(`/admin/reports/${tourId}`);
  await page.getByRole('link', { name: 'Xem tài khoản tác giả' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${uid}$`));
  await expect(page.getByRole('region', { name: 'Thông tin tài khoản' })).toBeVisible();
});
