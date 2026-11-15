// UC20 (#273, Frontend A #127 to #130): admin queue of reported tours, dossier and decisions.
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow, id, secondId, userId } from './fixtures.js';

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const authorId = '44444444-4444-4444-8444-444444444444';

const queue = {
  tours: [
    {
      tourId: id, title: 'Phố cổ bị báo cáo nhiều', status: 'public', authorId, openReportCount: 6,
      flagged: true, flaggedAt: hoursAgo(2), lastReportAt: hoursAgo(1), reasons: { spam: 4, false_info: 2 },
    },
    {
      tourId: secondId, title: 'Tour đã ẩn', status: 'hidden', authorId, openReportCount: 1,
      flagged: false, flaggedAt: null, lastReportAt: hoursAgo(5), reasons: { copyright: 1 },
    },
  ],
  page: 1, limit: 20, total: 2,
};

const dossier = (over = {}) => ({
  tour: {
    id, title: 'Phố cổ bị báo cáo nhiều', description: 'Mô tả tour', status: 'public', authorId,
    city: 'Hà Nội', averageRating: 4.5, ratingCount: 8,
  },
  reports: {
    openReportCount: 2, flagged: true, flaggedAt: hoursAgo(2),
    open: [
      { id: 'r1', reporterId: userId, reason: 'offensive', note: 'Nội dung phản cảm ở điểm 2', createdAt: hoursAgo(1) },
      { id: 'r2', reporterId: userId, reason: 'false_info', note: null, createdAt: hoursAgo(3) },
    ],
    dismissedCount: 3, actionedCount: 1,
  },
  actions: { hide: true, restore: false, dismiss: true },
  history: [
    { id: 'a1', adminId: userId, action: 'dismiss_reports', targetType: 'tour', targetId: id, reason: 'Không vi phạm',
      data: { status: 'public', reportCount: 3 }, createdAt: hoursAgo(30) },
  ],
  ...over,
});

/** Mocks the admin reports API; `handlers[key](route, body)` overrides one call. */
async function mockReports(page, handlers = {}) {
  const calls = [];
  await fixtures(page);
  await page.route('**/api/tours/admin/reports**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const tail = u.pathname.replace('/api/tours/admin/reports', '');
    const key = tail === '' || tail === '/' ? 'queue' : tail.split('/')[2] || 'dossier';
    calls.push({ key, method: req.method(), path: u.pathname, search: u.search, body, auth: req.headers().authorization });
    if (handlers[key]) return handlers[key](route, body);
    if (key === 'queue') return json(route, queue);
    if (key === 'dossier') return json(route, dossier());
    return json(route, { message: 'OK' });
  });
  return calls;
}

test('non-admin sees a notice and the admin API is not called', async ({ page }) => {
  await signIn(page, 'contributor');
  const calls = await mockReports(page);
  await page.goto('/admin/reports');
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  await page.goto(`/admin/reports/${id}`);
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  expect(calls).toHaveLength(0);
});

test('queue lists reported tours in API order with count, flag, status and reasons', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReports(page);
  await page.goto('/admin/reports');
  const rows = page.getByTestId('report-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Phố cổ bị báo cáo nhiều');
  await expect(rows.nth(0)).toContainText('6');
  await expect(rows.nth(0)).toContainText('Đạt ngưỡng');
  await expect(rows.nth(0)).toContainText('Công khai');
  await expect(rows.nth(0)).toContainText('Spam 4 · Sai sự thật 2');
  await expect(rows.nth(1)).toContainText('Tour đã ẩn');
  await expect(rows.nth(1)).toContainText('Đang ẩn');
  await expect(rows.nth(1)).toContainText('Vi phạm bản quyền 1');
  await expect(rows.nth(1)).not.toContainText('Đạt ngưỡng');
  expect(calls[0]).toMatchObject({ key: 'queue', method: 'GET', search: '?page=1&limit=20', auth: 'Bearer test-access' });
  await expect(page.getByRole('navigation', { name: 'Phân trang' })).toHaveCount(0);

  await rows.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/admin/reports/${id}$`));
});

test('queue pages through the reports', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReports(page, {
    queue: (route) => json(route, { ...queue, total: 45, page: Number(new URL(route.request().url()).searchParams.get('page')) }),
  });
  await page.goto('/admin/reports');
  await expect(page.getByText('Trang 1/3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect(page.getByText('Trang 2/3')).toBeVisible();
  await expect(page).toHaveURL(/\?page=2$/);
  expect(calls.at(-1).search).toBe('?page=2&limit=20');
});

test('empty queue shows "Không có tour bị báo cáo"', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReports(page, { queue: (route) => json(route, { tours: [], page: 1, limit: 20, total: 0 }) });
  await page.goto('/admin/reports');
  await expect(page.getByText('Không có tour bị báo cáo')).toBeVisible();
});

test('queue error shows the message and "Thử lại" reloads', async ({ page }) => {
  await signIn(page, 'admin');
  let fail = true;
  await mockReports(page, {
    queue: (route) => (fail ? json(route, { error: 'Máy chủ đang bận' }, 500) : json(route, queue)),
  });
  await page.goto('/admin/reports');
  await expect(page.getByRole('alert')).toContainText('Máy chủ đang bận');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByTestId('report-row')).toHaveCount(2);
});

test('dossier shows the tour, open reports with Vietnamese reasons, counts, history and links', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReports(page);
  await page.goto(`/admin/reports/${id}`);
  await expect(page.getByRole('region', { name: 'Thông tin tour' })).toContainText('Phố cổ bị báo cáo nhiều');
  await expect(page.getByRole('region', { name: 'Thông tin tour' })).toContainText('Hà Nội');
  await expect(page.getByRole('link', { name: 'Xem trang tour' })).toHaveAttribute('href', `/tour/${id}`);
  await expect(page.getByRole('link', { name: 'Xem tài khoản tác giả' })).toHaveAttribute('href', `/admin/users/${authorId}`);
  const reports = page.getByTestId('open-report');
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0)).toContainText('Phản cảm');
  await expect(reports.nth(0)).toContainText('Nội dung phản cảm ở điểm 2');
  await expect(reports.nth(1)).toContainText('Sai sự thật');
  await expect(reports.nth(1)).toContainText('Không có ghi chú');
  await expect(page.getByTestId('report-counts')).toContainText('Đã bỏ qua 3 · Đã xử lý 1');
  await expect(page.getByRole('region', { name: 'Báo cáo đang mở' })).toContainText('Đạt ngưỡng');
  const history = page.getByTestId('history-row');
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText('Bỏ qua báo cáo');
  await expect(history.first()).toContainText('Không vi phạm');
  // actions hint: hide + dismiss, no restore
  await expect(page.getByRole('button', { name: 'Ẩn tour' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ qua báo cáo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Khôi phục' })).toHaveCount(0);
});

test('dossier of an unknown tour shows "Không tìm thấy"', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReports(page, { dossier: (route) => json(route, { error: 'Không tìm thấy tour' }, 404) });
  await page.goto(`/admin/reports/${id}`);
  await expect(page.getByRole('alert')).toContainText('Không tìm thấy tour này');
  await expect(page.getByRole('link', { name: 'Về danh sách' })).toBeVisible();
});

test('hide requires a reason, then posts it and reloads the dossier', async ({ page }) => {
  await signIn(page, 'admin');
  let hidden = false;
  const calls = await mockReports(page, {
    dossier: (route) =>
      json(route, hidden
        ? dossier({
            tour: { ...dossier().tour, status: 'hidden' },
            reports: { ...dossier().reports, openReportCount: 0, flagged: false, open: [], actionedCount: 3 },
            actions: { hide: false, restore: true, dismiss: false },
          })
        : dossier()),
    hide: (route) => {
      hidden = true;
      return json(route, { message: 'Đã ẩn tour và báo cho tác giả', tour: { id, status: 'hidden' }, action: 'hide_tour', closedReports: 2 });
    },
  });
  await page.goto(`/admin/reports/${id}`);
  await page.getByRole('button', { name: 'Ẩn tour' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ẩn tour này?');
  await dialog.getByRole('button', { name: 'Ẩn tour' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập lý do');
  await dialog.getByLabel('Lý do (bắt buộc)').fill('   ');
  await dialog.getByRole('button', { name: 'Ẩn tour' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập lý do');
  expect(calls.filter((c) => c.key === 'hide')).toHaveLength(0);
  await expect(dialog.getByLabel('Lý do (bắt buộc)')).toHaveAttribute('maxlength', '1000');

  await dialog.getByLabel('Lý do (bắt buộc)').fill('  Nội dung sai sự thật  ');
  await dialog.getByRole('button', { name: 'Ẩn tour' }).click();
  await expect(page.getByRole('status')).toContainText('Đã ẩn tour và báo cho tác giả');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const hide = calls.find((c) => c.key === 'hide');
  expect(hide).toMatchObject({ method: 'POST', path: `/api/tours/admin/reports/${id}/hide`, body: { reason: 'Nội dung sai sự thật' } });
  await expect(page.getByRole('region', { name: 'Thông tin tour' })).toContainText('Đang ẩn');
  await expect(page.getByRole('button', { name: 'Khôi phục' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ẩn tour' })).toHaveCount(0);
});

test('restore sends an optional reason; an empty box sends no reason', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReports(page, {
    dossier: (route) => json(route, dossier({ tour: { ...dossier().tour, status: 'hidden' }, actions: { hide: false, restore: true, dismiss: true } })),
    restore: (route) => json(route, { message: 'Đã khôi phục tour', tour: { id, status: 'public' }, action: 'restore_tour' }),
  });
  await page.goto(`/admin/reports/${id}`);
  await page.getByRole('button', { name: 'Khôi phục' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Lý do (không bắt buộc)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Khôi phục' }).click();
  await expect(page.getByRole('status')).toContainText('Đã khôi phục tour');
  expect(calls.find((c) => c.key === 'restore')).toMatchObject({ method: 'POST', path: `/api/tours/admin/reports/${id}/restore`, body: {} });

  await page.getByRole('button', { name: 'Khôi phục' }).click();
  await page.getByRole('dialog').getByLabel('Lý do (không bắt buộc)').fill('Bị báo cáo hàng loạt');
  await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter((c) => c.key === 'restore').at(-1).body).toEqual({ reason: 'Bị báo cáo hàng loạt' });
});

test('dismiss posts the reason and reloads the dossier', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReports(page, {
    dismiss: (route) => json(route, { message: 'Đã bỏ qua 2 báo cáo', tourId: id, status: 'public', action: 'dismiss_reports', dismissedReports: 2 }),
  });
  await page.goto(`/admin/reports/${id}`);
  await expect(page.getByTestId('open-report')).toHaveCount(2);
  const before = calls.filter((c) => c.key === 'dossier').length; // StrictMode may load twice
  await page.getByRole('button', { name: 'Bỏ qua báo cáo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Lý do (không bắt buộc)').fill('Không có vi phạm');
  await dialog.getByRole('button', { name: 'Bỏ qua báo cáo' }).click();
  await expect(page.getByRole('status')).toContainText('Đã bỏ qua 2 báo cáo');
  expect(calls.find((c) => c.key === 'dismiss')).toMatchObject({
    method: 'POST', path: `/api/tours/admin/reports/${id}/dismiss`, body: { reason: 'Không có vi phạm' },
  });
  await expect.poll(() => calls.filter((c) => c.key === 'dossier').length).toBe(before + 1);
});

test('a 409 (another admin acted first) is shown and the dossier reloaded', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReports(page, {
    dismiss: (route) => json(route, { error: 'Tour không còn báo cáo nào đang mở', code: 'no_open_reports' }, 409),
  });
  await page.goto(`/admin/reports/${id}`);
  await expect(page.getByTestId('open-report')).toHaveCount(2);
  const before = calls.filter((c) => c.key === 'dossier').length; // StrictMode may load twice
  await page.getByRole('button', { name: 'Bỏ qua báo cáo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bỏ qua báo cáo' }).click();
  await expect(page.getByTestId('dossier-notice')).toContainText('Tour không còn báo cáo nào đang mở');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.key === 'dossier').length).toBe(before + 1);
});

test('a 422 is shown inside the dialog', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReports(page, { hide: (route) => json(route, { error: 'Lý do tối đa 1000 ký tự' }, 422) });
  await page.goto(`/admin/reports/${id}`);
  await page.getByRole('button', { name: 'Ẩn tour' }).click();
  await page.getByRole('dialog').getByLabel('Lý do (bắt buộc)').fill('abc');
  await page.getByRole('dialog').getByRole('button', { name: 'Ẩn tour' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Lý do tối đa 1000 ký tự');
});

test('account menu leads admins to the admin area; queue and dossier fit 390 px', async ({ page, context }) => {
  await signIn(page, 'admin');
  await mockReports(page, {
    queue: (route) =>
      json(route, {
        ...queue,
        total: 45,
        tours: [{ ...queue.tours[0], title: 'Một tiêu đề tour rất dài '.repeat(6), reasons: { spam: 1, false_info: 1, offensive: 1, copyright: 1, other: 1 } }],
      }),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: /Quản trị/ }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('link', { name: /Tour bị báo cáo/ }).click();
  await expect(page.getByTestId('report-row')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Thiết bị đang online' })).toBeVisible();
  await noOverflow(page);
  await page.getByTestId('report-row').click();
  await expect(page.getByTestId('open-report')).toHaveCount(2);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Ẩn tour' }).click();
  await noOverflow(page);

  const other = await context.newPage();
  await signIn(other, 'tourist');
  await fixtures(other);
  await other.goto('/account');
  await expect(other.getByRole('link', { name: 'Thiết bị đang đăng nhập' })).toBeVisible();
  await expect(other.getByRole('link', { name: /Quản trị/ })).toHaveCount(0);
});
