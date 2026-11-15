// UC05 (#267): tour ratings on the tour detail page (#105 submit, #162 edit/delete,
// #163 missing-star validation) and the "Đánh giá tour" link on the player end screen.
import { test, expect } from '@playwright/test';
import { id, userId, tour, places, json, signIn, fixtures, noOverflow } from './fixtures.js';

const raterId = '55555555-5555-4555-8555-555555555555';
const at = (d) => `2026-11-0${d}T03:00:00.000Z`;

const review = (n, extra = {}) => ({
  id: `r-${n}`,
  userName: `Người nghe ${n}`,
  stars: (n % 5) + 1,
  comment: `Nhận xét số ${n}`,
  createdAt: at(1),
  updatedAt: at(1),
  ...extra,
});

const baseSummary = { averageRating: 4.2, ratingCount: 5, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 3 } };

/** Mocks /api/tours/:id/ratings*; `handlers` override single endpoints. */
async function mockRatings(page, { items = [review(1), review(2)], total, summary = baseSummary, mine = null } = {}, handlers = {}) {
  const state = { calls: [], bodies: [], mine };
  await fixtures(page);
  await page.route('**/api/tours/*/ratings**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const method = req.method();
    state.calls.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname.endsWith('/ratings') && method === 'GET') {
      if (handlers.list) return handlers.list(route, state, u);
      const page = Number(u.searchParams.get('page') || 1);
      const limit = Number(u.searchParams.get('limit') || 10);
      return json(route, {
        summary,
        items: items.slice((page - 1) * limit, page * limit),
        page,
        limit,
        total: total ?? items.length,
      });
    }
    if (u.pathname.endsWith('/ratings/mine')) {
      if (method === 'GET') return handlers.mine ? handlers.mine(route, state) : json(route, { rating: state.mine });
      if (method === 'PUT') {
        const body = req.postDataJSON();
        state.bodies.push(body);
        if (handlers.save) return handlers.save(route, state, body);
        const created = !state.mine;
        state.mine = {
          id: state.mine?.id || 'r-mine',
          userName: 'Test contributor',
          stars: body.stars,
          comment: body.comment ?? null,
          createdAt: state.mine?.createdAt || at(3),
          updatedAt: at(4),
        };
        return json(
          route,
          { rating: state.mine, summary: { averageRating: created ? 4.5 : 3.8, ratingCount: created ? 6 : 5 } },
          created ? 201 : 200,
        );
      }
      if (method === 'DELETE') {
        if (handlers.remove) return handlers.remove(route, state);
        state.mine = null;
        return route.fulfill({ status: 204 });
      }
    }
    return json(route, { error: 'unexpected' }, 404);
  });
  return state;
}

const section = (page) => page.locator('#ratings');
const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const puts = (state) => state.calls.filter((c) => c.startsWith('PUT'));

test('guest sees summary, comments and a sign-in prompt, no form; fits 390 px', async ({ page }) => {
  await mockRatings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id);
  const s = section(page);
  await expect(s.getByTestId('rating-summary')).toContainText('4,2');
  await expect(s.getByTestId('rating-summary')).toContainText('5 lượt đánh giá');
  await expect(s.getByRole('listitem', { name: '5 sao: 3 lượt' })).toBeVisible();
  await expect(s.getByTestId('rating-item')).toHaveCount(2);
  await expect(s.getByTestId('rating-item').first()).toContainText('Người nghe 1');
  const login = s.getByRole('link', { name: 'Đăng nhập để đánh giá' });
  await expect(login).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/tour/${id}#ratings`)}`);
  await expect(s.getByRole('radiogroup')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Gửi đánh giá' })).toHaveCount(0);
  await noOverflow(page);
});

test('missing star: inline error, no request, draft kept; keyboard pick then submit', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  const state = await mockRatings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tour/' + id);
  const s = section(page);
  const comment = s.getByLabel('Nhận xét (không bắt buộc)');
  await comment.fill('Rất hay');
  await expect(s.getByText('7/1000')).toBeVisible();
  await s.getByRole('button', { name: 'Gửi đánh giá' }).click();
  const err = s.getByRole('alert').filter({ hasText: 'Vui lòng chọn số sao' });
  await expect(err).toBeVisible();
  await expect(s.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  expect(puts(state)).toHaveLength(0);
  await expect(comment).toHaveValue('Rất hay');

  // Keyboard: focus the first star, arrow to the fourth.
  await s.getByRole('radio', { name: '1 sao' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(s.getByRole('radio', { name: '4 sao' })).toBeChecked();
  await expect(err).toHaveCount(0);
  await noOverflow(page);

  const listGets = () => state.calls.filter((c) => c.startsWith('GET') && c.includes('/ratings?')).length;
  const listsBefore = listGets();
  await s.getByRole('button', { name: 'Gửi đánh giá' }).click();
  await expect(toast(page, 'Cảm ơn đánh giá của bạn')).toBeVisible();
  expect(state.bodies).toEqual([{ stars: 4, comment: 'Rất hay' }]);
  expect(puts(state)).toEqual([`PUT /api/tours/${id}/ratings/mine`]);
  // Summary from the response, distribution and list updated without a reload.
  await expect(s.getByTestId('rating-summary')).toContainText('4,5');
  await expect(s.getByTestId('rating-summary')).toContainText('6 lượt đánh giá');
  await expect(s.getByRole('listitem', { name: '4 sao: 2 lượt' })).toBeVisible();
  await expect(s.getByTestId('rating-item')).toHaveCount(3);
  await expect(page.locator('.detail__rating .rating')).toContainText('4,5');
  const mine = s.getByTestId('my-rating');
  await expect(mine).toContainText('Rất hay');
  await expect(mine.getByRole('button', { name: 'Sửa' })).toBeVisible();
  await expect(mine.getByRole('button', { name: 'Xoá' })).toBeVisible();
  expect(listGets()).toBe(listsBefore); // no reload of the list
});

test('edit an existing rating; cancel keeps it; save updates summary', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  const own = review(9, { id: 'r-mine', userName: 'Test contributor', stars: 5, comment: 'Tuyệt' });
  const state = await mockRatings(page, { items: [own, review(1)], mine: own });
  await page.goto('/tour/' + id);
  const s = section(page);
  const mine = s.getByTestId('my-rating');
  await expect(mine).toContainText('Tuyệt');
  await expect(mine.getByRole('img', { name: '5 trên 5 sao' })).toBeVisible();

  await mine.getByRole('button', { name: 'Sửa' }).click();
  await expect(s.getByRole('radio', { name: '5 sao' })).toBeChecked();
  await expect(s.getByLabel('Nhận xét (không bắt buộc)')).toHaveValue('Tuyệt');
  await s.getByRole('button', { name: 'Huỷ' }).click();
  await expect(s.getByTestId('my-rating')).toBeVisible();
  expect(puts(state)).toHaveLength(0);

  await s.getByTestId('my-rating').getByRole('button', { name: 'Sửa' }).click();
  await s.locator('label').filter({ has: page.getByRole('radio', { name: '2 sao' }) }).click();
  await s.getByLabel('Nhận xét (không bắt buộc)').fill('Tạm được');
  await s.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(toast(page, 'Đã cập nhật đánh giá')).toBeVisible();
  expect(state.bodies).toEqual([{ stars: 2, comment: 'Tạm được' }]);
  await expect(s.getByTestId('rating-summary')).toContainText('3,8');
  await expect(s.getByTestId('rating-summary')).toContainText('5 lượt đánh giá');
  await expect(s.getByRole('listitem', { name: '5 sao: 2 lượt' })).toBeVisible();
  await expect(s.getByRole('listitem', { name: '2 sao: 2 lượt' })).toBeVisible();
  await expect(s.getByTestId('rating-item')).toHaveCount(2);
  await expect(s.getByTestId('rating-item').first()).toContainText('Tạm được');
  await expect(s.getByTestId('my-rating')).toContainText('Tạm được');
});

test('delete asks for confirmation; cancel keeps the rating, confirm removes it', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  const own = review(9, { id: 'r-mine', stars: 5, comment: 'Tuyệt' });
  const state = await mockRatings(page, { items: [own, review(1)], mine: own });
  await page.goto('/tour/' + id);
  const s = section(page);
  await s.getByTestId('my-rating').getByRole('button', { name: 'Xoá' }).click();
  const dialog = page.getByRole('dialog', { name: 'Xoá đánh giá của bạn?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Huỷ' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.calls.filter((c) => c.startsWith('DELETE'))).toHaveLength(0);
  await expect(s.getByTestId('my-rating')).toBeVisible();

  await s.getByTestId('my-rating').getByRole('button', { name: 'Xoá' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xoá', exact: true }).click();
  await expect(toast(page, 'Đã xoá đánh giá')).toBeVisible();
  expect(state.calls.filter((c) => c.startsWith('DELETE'))).toEqual([`DELETE /api/tours/${id}/ratings/mine`]);
  await expect(s.getByTestId('my-rating')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Gửi đánh giá' })).toBeVisible();
  await expect(s.getByTestId('rating-item')).toHaveCount(1);
  // (4.2 * 5 - 5) / 4 = 4.0
  await expect(s.getByTestId('rating-summary')).toContainText('4,0');
  await expect(s.getByTestId('rating-summary')).toContainText('4 lượt đánh giá');
  await expect(s.getByRole('listitem', { name: '5 sao: 2 lượt' })).toBeVisible();
});

test('delete failure keeps the rating and shows the API message', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  const own = review(9, { id: 'r-mine', stars: 5 });
  await mockRatings(page, { items: [own], mine: own }, {
    remove: (route) => json(route, { error: 'Máy chủ đang bận' }, 500),
  });
  await page.goto('/tour/' + id);
  const s = section(page);
  await s.getByTestId('my-rating').getByRole('button', { name: 'Xoá' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xoá', exact: true }).click();
  await expect(toast(page, 'Máy chủ đang bận')).toBeVisible();
  await expect(s.getByTestId('my-rating')).toBeVisible();
});

test('comments page with "Xem thêm", newest first, until all are loaded', async ({ page }) => {
  const items = Array.from({ length: 12 }, (_, i) => review(i + 1));
  const state = await mockRatings(page, { items });
  await page.goto('/tour/' + id);
  const s = section(page);
  await expect(s.getByTestId('rating-item')).toHaveCount(10);
  await s.getByRole('button', { name: 'Xem thêm' }).click();
  await expect(s.getByTestId('rating-item')).toHaveCount(12);
  await expect(s.getByTestId('rating-item').last()).toContainText('Người nghe 12');
  await expect(s.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
  // Dev StrictMode may run the first load twice: compare the distinct requests.
  expect([...new Set(state.calls.filter((c) => c.includes('/ratings?')))]).toEqual([
    `GET /api/tours/${id}/ratings?page=1&limit=10`,
    `GET /api/tours/${id}/ratings?page=2&limit=10`,
  ]);
});

test('empty list and list error with retry', async ({ page }) => {
  let fail = true;
  await mockRatings(page, { items: [], summary: { averageRating: 0, ratingCount: 0, distribution: {} } }, {
    list: (route) =>
      fail
        ? route.abort('internetdisconnected')
        : json(route, { summary: { averageRating: 0, ratingCount: 0, distribution: {} }, items: [], page: 1, limit: 10, total: 0 }),
  });
  await page.goto('/tour/' + id);
  const s = section(page);
  const alert = s.getByRole('alert').filter({ hasText: 'Không thể kết nối, vui lòng thử lại' });
  await expect(alert).toBeVisible();
  fail = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(s.getByText('Chưa có nhận xét nào')).toBeVisible();
});

test('submit error shows the API message and keeps the draft', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  const state = await mockRatings(page, {}, {
    save: (route) => json(route, { error: 'Nhận xét tối đa 1000 ký tự', code: 'validation_error' }, 400),
  });
  await page.goto('/tour/' + id);
  const s = section(page);
  await s.locator('label').filter({ has: page.getByRole('radio', { name: '3 sao' }) }).click();
  await s.getByLabel('Nhận xét (không bắt buộc)').fill('Bản nháp');
  await s.getByRole('button', { name: 'Gửi đánh giá' }).click();
  await expect(s.getByRole('alert').filter({ hasText: 'Nhận xét tối đa 1000 ký tự' })).toBeVisible();
  await expect(s.getByRole('radio', { name: '3 sao' })).toBeChecked();
  await expect(s.getByLabel('Nhận xét (không bắt buộc)')).toHaveValue('Bản nháp');
  expect(state.bodies).toHaveLength(1);
  // The draft survives a reload (e.g. a sign-in round trip).
  await page.reload();
  await expect(s.getByRole('radio', { name: '3 sao' })).toBeChecked();
  await expect(s.getByLabel('Nhận xét (không bắt buộc)')).toHaveValue('Bản nháp');
});

test('own tour: 403 own_tour message replaces the form', async ({ page }) => {
  await signIn(page, 'contributor', raterId);
  await mockRatings(page, {}, {
    save: (route) => json(route, { error: 'Bạn không thể tự đánh giá tour của mình', code: 'own_tour' }, 403),
  });
  await page.goto('/tour/' + id);
  const s = section(page);
  await s.locator('label').filter({ has: page.getByRole('radio', { name: '5 sao' }) }).click();
  await s.getByRole('button', { name: 'Gửi đánh giá' }).click();
  await expect(s.getByRole('alert').filter({ hasText: 'Bạn không thể tự đánh giá tour của mình' })).toBeVisible();
  await expect(s.getByRole('radiogroup')).toHaveCount(0);
});

test('the author (authorId in the detail) sees no form', async ({ page }) => {
  expect(tour.authorId).toBe(userId);
  await signIn(page, 'contributor', userId);
  const state = await mockRatings(page);
  await page.goto('/tour/' + id);
  const s = section(page);
  await expect(s.getByText('Bạn là tác giả của tour này')).toBeVisible();
  await expect(s.getByRole('radiogroup')).toHaveCount(0);
  expect(state.calls.filter((c) => c.includes('/mine'))).toHaveLength(0);
});

test('player end screen links to the ratings section', async ({ page }) => {
  await signIn(page, 'tourist', raterId);
  await mockRatings(page);
  // First stop already heard; speech ends at once, so finishing the last stop completes the tour.
  await page.addInitScript(
    ({ tourId, first }) => {
      localStorage.setItem('geosound:progress:' + tourId, JSON.stringify({ visited: [first], lastPlaceId: first, lang: 'vi' }));
      window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(new Event('end')), 50);
    },
    { tourId: id, first: places[0].id },
  );
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + places[1].id);
  const dialog = page.getByRole('dialog', { name: 'Hoàn thành tour' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByText('Bạn thấy tour này thế nào?')).toBeVisible();
  await dialog.getByRole('link', { name: 'Đánh giá tour' }).click();
  await expect(page).toHaveURL(new RegExp(`/tour/${id}#ratings$`));
  await expect(section(page).getByRole('button', { name: 'Gửi đánh giá' })).toBeVisible();
});
