// UC06 (#268): report a tour from the tour detail page and the player
// (#106 submit, #164 already reported, #165 "Khác" needs a note).
import { test, expect } from '@playwright/test';
import { id, secondId, userId, json, signIn, fixtures, noOverflow } from './fixtures.js';

const reporterId = '66666666-6666-4666-8666-666666666666';
const reportedAt = '2026-11-02T08:30:00.000Z';

/** Mocks /api/tours/:id/reports*; `handlers` override single endpoints. */
async function mockReports(page, { mine = null } = {}, handlers = {}) {
  const state = { calls: [], bodies: [], mine };
  await fixtures(page);
  await page.route('**/api/tours/*/reports**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    state.calls.push(`${method} ${path}`);
    if (method === 'GET' && path.endsWith('/reports/mine')) {
      if (handlers.mine) return handlers.mine(route, state);
      return json(route, { report: state.mine });
    }
    if (method === 'POST' && path.endsWith('/reports')) {
      const body = req.postDataJSON();
      state.bodies.push(body);
      if (handlers.submit) return handlers.submit(route, state, body);
      state.mine = { reason: body.reason, note: body.note ?? null, createdAt: reportedAt };
      return json(route, { report: { id: 'rep-1', ...state.mine }, flagged: false }, 201);
    }
    return json(route, { error: 'unexpected' }, 404);
  });
  return state;
}

const dialog = (page) => page.getByRole('dialog', { name: 'Báo cáo tour' });
const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const posts = (state) => state.calls.filter((c) => c.startsWith('POST'));
const openFromDetail = (page) => page.getByRole('button', { name: 'Báo cáo', exact: true }).click();

test('guest is asked to sign in and comes back to the dialog', async ({ page }) => {
  await mockReports(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  const d = dialog(page);
  await expect(d.getByText('Bạn cần đăng nhập để báo cáo tour này.')).toBeVisible();
  await expect(d.getByRole('radiogroup')).toHaveCount(0);
  await expect(d.getByRole('link', { name: 'Đăng nhập để báo cáo' })).toHaveAttribute(
    'href',
    `/login?next=${encodeURIComponent(`/tour/${id}?report=1`)}`,
  );
  await noOverflow(page);
});

test('after sign-in, ?report=1 reopens the dialog and drops the parameter', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  await mockReports(page);
  await page.goto('/tour/' + id + '?report=1');
  await expect(dialog(page).getByRole('radiogroup', { name: 'Lý do báo cáo' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/tour/${id}$`));
});

test('validation: reason required, "Khác" needs a note, no request; keyboard then submit', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  const state = await mockReports(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  const d = dialog(page);

  await d.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(d.getByRole('alert').filter({ hasText: 'Vui lòng chọn lý do báo cáo' })).toBeVisible();
  await expect(d.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  expect(posts(state)).toHaveLength(0);

  // Keyboard: focus the first reason, arrow down to "Khác" (the last one).
  await d.getByRole('radio', { name: 'Sai sự thật' }).focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
  await expect(d.getByRole('radio', { name: 'Khác' })).toBeChecked();
  await expect(d.getByText('Vui lòng chọn lý do báo cáo')).toHaveCount(0);

  const note = d.getByLabel('Mô tả lý do (bắt buộc)');
  await note.fill('   ');
  await d.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(d.getByRole('alert').filter({ hasText: 'Vui lòng mô tả lý do' })).toBeVisible();
  await expect(note).toHaveAttribute('aria-invalid', 'true');
  await expect(d.getByRole('radio', { name: 'Khác' })).toBeChecked();
  expect(posts(state)).toHaveLength(0);
  await noOverflow(page);

  await note.fill('Thuyết minh chép từ sách');
  await expect(d.getByText('Vui lòng mô tả lý do')).toHaveCount(0);
  await expect(d.getByText('24/500')).toBeVisible();
  await d.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(toast(page, 'Đã gửi báo cáo, cảm ơn bạn')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  expect(state.bodies).toEqual([{ reason: 'other', note: 'Thuyết minh chép từ sách' }]);
  expect(posts(state)).toEqual([`POST /api/tours/${id}/reports`]);

  // Opening again shows the already-reported state, no second form.
  await openFromDetail(page);
  await expect(dialog(page).getByTestId('report-done')).toContainText('Bạn đã báo cáo tour này');
  await expect(dialog(page).getByRole('radiogroup')).toHaveCount(0);
});

test('a reason without a note sends only the reason', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  const state = await mockReports(page);
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  await dialog(page).getByText('Spam', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(toast(page, 'Đã gửi báo cáo, cảm ơn bạn')).toBeVisible();
  expect(state.bodies).toEqual([{ reason: 'spam' }]);
});

test('already reported (reports/mine): date and reason instead of the form', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  const state = await mockReports(page, { mine: { reason: 'copyright', note: 'Ảnh của tôi', createdAt: reportedAt } });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  const done = dialog(page).getByTestId('report-done');
  await expect(done).toContainText('Bạn đã báo cáo tour này');
  await expect(done).toContainText('Vi phạm bản quyền');
  await expect(done).toContainText('Ảnh của tôi');
  await expect(done.locator('time')).toHaveAttribute('datetime', reportedAt);
  await expect(dialog(page).getByRole('button', { name: 'Gửi báo cáo' })).toHaveCount(0);
  await done.getByRole('button', { name: 'Quay lại tour' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(posts(state)).toHaveLength(0);
});

test('409 already_reported shows the server state, never the success toast', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  let mineCalls = 0;
  await mockReports(page, {}, {
    // First check says none (e.g. reported from another device meanwhile), the re-check after 409 has it.
    mine: (route) => json(route, { report: mineCalls++ ? { reason: 'spam', note: null, createdAt: reportedAt } : null }),
    submit: (route) => json(route, { error: 'Bạn đã báo cáo tour này', code: 'already_reported' }, 409),
  });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  await dialog(page).getByText('Phản cảm', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Gửi báo cáo' }).click();
  const done = dialog(page).getByTestId('report-done');
  await expect(done).toContainText('Bạn đã báo cáo tour này');
  await expect(done).toContainText('Spam');
  await expect(done.locator('time')).toHaveAttribute('datetime', reportedAt);
  await expect(toast(page, 'Đã gửi báo cáo')).toHaveCount(0);
});

test('409 without a readable status shows no invented date', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  let mineCalls = 0;
  await mockReports(page, {}, {
    mine: (route) => (mineCalls++ ? json(route, { error: 'Lỗi máy chủ' }, 500) : json(route, { report: null })),
    submit: (route) => json(route, { error: 'Bạn đã báo cáo tour này', code: 'already_reported' }, 409),
  });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  await dialog(page).getByText('Spam', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Gửi báo cáo' }).click();
  const done = dialog(page).getByTestId('report-done');
  await expect(done).toContainText('Bạn đã báo cáo tour này');
  await expect(done.locator('time')).toHaveCount(0);
});

test('server error shows the API message and keeps the draft', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  const state = await mockReports(page, {}, {
    submit: (route) => json(route, { error: 'Máy chủ đang bận, vui lòng thử lại' }, 503),
  });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  const d = dialog(page);
  await d.getByText('Sai sự thật', { exact: true }).click();
  await d.getByLabel('Mô tả thêm (không bắt buộc)').fill('Năm xây dựng sai');
  await d.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(d.getByRole('alert').filter({ hasText: 'Máy chủ đang bận, vui lòng thử lại' })).toBeVisible();
  await expect(d.getByRole('radio', { name: 'Sai sự thật' })).toBeChecked();
  await expect(d.getByLabel('Mô tả thêm (không bắt buộc)')).toHaveValue('Năm xây dựng sai');
  await expect(toast(page, 'Đã gửi báo cáo')).toHaveCount(0);
  expect(state.bodies).toHaveLength(1);
  // Draft survives closing and reopening (and a reload / sign-in round trip).
  await d.getByRole('button', { name: 'Huỷ' }).click();
  await page.reload();
  await openFromDetail(page);
  await expect(dialog(page).getByRole('radio', { name: 'Sai sự thật' })).toBeChecked();
  await expect(dialog(page).getByLabel('Mô tả thêm (không bắt buộc)')).toHaveValue('Năm xây dựng sai');
});

test('network error on the status check offers "Thử lại"', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  let fail = true;
  await mockReports(page, {}, {
    mine: (route) => (fail ? route.abort('internetdisconnected') : json(route, { report: null })),
  });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  const alert = dialog(page).getByRole('alert').filter({ hasText: 'Không thể kết nối, vui lòng thử lại' });
  await expect(alert).toBeVisible();
  fail = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog(page).getByRole('radiogroup', { name: 'Lý do báo cáo' })).toBeVisible();
});

test('own tour: 403 own_tour message replaces the form; author sees no entry', async ({ page }) => {
  await signIn(page, 'contributor', reporterId);
  await mockReports(page, {}, {
    submit: (route) => json(route, { error: 'Bạn không thể báo cáo tour của chính mình', code: 'own_tour' }, 403),
  });
  await page.goto('/tour/' + id);
  await openFromDetail(page);
  await dialog(page).getByText('Spam', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'Bạn không thể báo cáo tour của chính mình' })).toBeVisible();
  await expect(dialog(page).getByRole('radiogroup')).toHaveCount(0);
});

test('the author (authorId in the detail) has no report entry', async ({ page }) => {
  await signIn(page, 'contributor', userId);
  await mockReports(page);
  await page.goto('/tour/' + id);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Báo cáo', exact: true })).toHaveCount(0);
});

test('player topbar has a report button; fits 390 px', async ({ page }) => {
  await signIn(page, 'tourist', reporterId);
  const state = await mockReports(page);
  await page.addInitScript(() => {
    window.speechSynthesis.speak = () => {};
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  await page.getByRole('button', { name: 'Báo cáo tour' }).click();
  const d = dialog(page);
  await d.getByText('Phản cảm', { exact: true }).click();
  await d.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(toast(page, 'Đã gửi báo cáo, cảm ơn bạn')).toBeVisible();
  expect(state.bodies).toEqual([{ reason: 'offensive' }]);
  await noOverflow(page);
});
