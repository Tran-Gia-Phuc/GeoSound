// UC14: restricted access with a passcode — owner settings (Studio) and tester unlock.
import { test, expect } from '@playwright/test';
import { id, tour, json, signIn, fixtures, noOverflow } from './fixtures.js';

const accessPath = `/api/tours/mine/${id}/access`;

/** Owner side: mocks the tour status and /access; returns the call log. */
async function mockOwner(page, { status = 'draft', access, put, del } = {}) {
  const state = {
    status,
    access: access ?? { restricted: status === 'restricted', passcodeSetAt: status === 'restricted' ? '2026-11-01T08:00:00.000Z' : null, testers: status === 'restricted' ? 3 : 0 },
    calls: [],
    bodies: [],
  };
  await fixtures(page);
  await page.route(`**/api/tours/mine/${id}`, (route) => json(route, { tour: { ...tour, status: state.status } }));
  await page.route(`**/api/tours/mine/${id}/readiness`, (route) =>
    json(route, {
      readiness: {
        ready: true,
        canPublish: state.status !== 'restricted',
        placeCount: 2,
        checks: [{ key: 'title', label: 'Tên tour', required: true, ok: true }],
      },
    }),
  );
  await page.route(`**${accessPath}`, async (route) => {
    const req = route.request();
    const method = req.method();
    state.calls.push(method);
    if (method === 'GET') return json(route, state.access);
    if (method === 'PUT') {
      state.bodies.push(req.postDataJSON());
      if (put) return put(route, state);
      const changed = state.access.restricted ? 'passcode' : 'enabled';
      state.status = 'restricted';
      state.access = { restricted: true, passcodeSetAt: '2026-11-04T09:00:00.000Z', testers: changed === 'passcode' ? 0 : state.access.testers };
      return json(route, { ...state.access, changed });
    }
    if (method === 'DELETE') {
      if (del) return del(route, state);
      state.status = 'draft';
      state.access = { restricted: false, passcodeSetAt: null, testers: 0 };
      return json(route, { tour: { ...tour, status: 'draft' } });
    }
    return json(route, { error: 'unexpected' }, 404);
  });
  return state;
}

const panel = (page) => page.locator('section.restricted');
const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });

test('owner turns restricted mode on: validation, PUT, status and share link', async ({ page }) => {
  await signIn(page);
  const state = await mockOwner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/publish`);
  const p = panel(page);
  await expect(p).toContainText('Truy cập hạn chế');
  await expect(p).toContainText('Đang tắt');
  const field = p.getByLabel('Mã truy cập');
  const turnOn = p.getByRole('button', { name: 'Bật truy cập hạn chế' });

  await turnOn.click();
  await expect(p.getByText('Vui lòng nhập mã truy cập')).toBeVisible();
  await field.fill('abc');
  await turnOn.click();
  await expect(p.getByText('Mã truy cập phải từ 6 đến 32 ký tự')).toBeVisible();
  await field.fill('abc def123');
  await turnOn.click();
  await expect(p.getByText('Mã truy cập không được chứa khoảng trắng')).toBeVisible();
  await field.fill('x'.repeat(33));
  await turnOn.click();
  await expect(p.getByText('Mã truy cập phải từ 6 đến 32 ký tự')).toBeVisible();
  expect(state.calls.filter((c) => c === 'PUT')).toHaveLength(0);

  await field.fill('  thu-nghiem-1 ');
  await turnOn.click();
  await expect(toast(page, 'Đã bật truy cập hạn chế')).toBeVisible();
  expect(state.bodies[0]).toEqual({ passcode: 'thu-nghiem-1' });
  await expect(p).toContainText('Đang bật');
  await expect(p).toContainText('0 người thử đã mở khoá');
  await expect(p.getByLabel('Liên kết gửi cho người thử')).toHaveValue(new RegExp(`/tour/${id}/unlock$`));
  await expect(p.getByRole('link', { name: 'Mở bản người thử thấy' })).toHaveAttribute('href', `/tour/${id}/restricted`);
  // The layout reloads the tour: status chip and the publish hint follow.
  await expect(page.locator('.appheader')).toContainText('Truy cập hạn chế');
  await expect(page.locator('section.publish').first()).toContainText('Tour đang ở chế độ truy cập hạn chế');
  await noOverflow(page);
});

test('owner changes the passcode with a warning for testers', async ({ page }) => {
  await signIn(page);
  const state = await mockOwner(page, { status: 'restricted' });
  await page.goto(`/studio/tours/${id}/publish`);
  const p = panel(page);
  await expect(p).toContainText('Đang bật');
  await expect(p).toContainText('3 người thử đã mở khoá');
  await p.getByRole('button', { name: 'Đổi mã truy cập' }).click();
  await expect(p).toContainText('mọi người thử phải nhập mã mới');
  await p.getByLabel('Mã truy cập mới').fill('ma-moi-2026');
  await p.getByRole('button', { name: 'Lưu mã mới' }).click();
  await expect(toast(page, 'Đã đổi mã truy cập. Người thử cần nhập mã mới.')).toBeVisible();
  await expect(p).toContainText('0 người thử đã mở khoá');
  expect(state.bodies).toEqual([{ passcode: 'ma-moi-2026' }]);
});

test('owner turns restricted mode off after confirmation; cancel keeps it', async ({ page }) => {
  await signIn(page);
  const state = await mockOwner(page, { status: 'restricted' });
  await page.goto(`/studio/tours/${id}/publish`);
  const p = panel(page);
  await p.getByRole('button', { name: 'Tắt truy cập hạn chế' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ' }).click();
  expect(state.calls).not.toContain('DELETE');
  await p.getByRole('button', { name: 'Tắt truy cập hạn chế' }).click();
  await expect(page.getByRole('dialog')).toContainText('Tour sẽ về Nháp');
  await page.getByRole('dialog').getByRole('button', { name: 'Tắt truy cập' }).click();
  await expect(toast(page, 'Đã tắt truy cập hạn chế. Tour đã về Nháp.')).toBeVisible();
  await expect(p).toContainText('Đang tắt');
  await expect(page.locator('.appheader')).toContainText('Nháp');
  expect(state.calls).toContain('DELETE');
});

test('409: a public tour must be unpublished first; the server message is shown', async ({ page }) => {
  await signIn(page);
  const msg = 'Chỉ bật truy cập hạn chế cho tour Nháp, bị từ chối hoặc cần chỉnh sửa (tour công khai cần gỡ xuống trước)';
  await mockOwner(page, {
    status: 'public',
    put: (route) => json(route, { code: 'tour_not_restrictable', error: msg }, 409),
  });
  await page.goto(`/studio/tours/${id}/publish`);
  const p = panel(page);
  await expect(p).toContainText('Tour đang công khai: hãy gỡ xuống trước khi bật truy cập hạn chế.');
  await p.getByLabel('Mã truy cập').fill('thu-nghiem-1');
  await p.getByRole('button', { name: 'Bật truy cập hạn chế' }).click();
  await expect(p.getByRole('alert')).toContainText(msg);
  await expect(p).toContainText('Đang tắt');
});

test('publish refused with tour_restricted shows the server message', async ({ page }) => {
  await signIn(page);
  await mockOwner(page);
  const msg = 'Tour đang ở chế độ truy cập hạn chế, hãy tắt chế độ này trước khi gửi duyệt';
  await page.route(`**/api/tours/mine/${id}/publish`, (route) => json(route, { code: 'tour_restricted', error: msg }, 409));
  await page.goto(`/studio/tours/${id}/publish`);
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.locator('section.publish').first().getByRole('alert')).toContainText(msg);
});

test('access panel load failure shows retry', async ({ page }) => {
  await signIn(page);
  await mockOwner(page);
  let fail = true;
  await page.route(`**${accessPath}`, (route) =>
    fail ? route.abort('failed') : json(route, { restricted: false, passcodeSetAt: null, testers: 0 }),
  );
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(panel(page).getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await panel(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(panel(page)).toContainText('Đang tắt');
});

/** Tester side: access/mine, unlock and the restricted view. */
async function mockTester(page, { unlocked = false, unlock, restricted, mine } = {}) {
  const state = { unlocked, calls: [], bodies: [] };
  await fixtures(page);
  await page.route(`**/api/tours/${id}/access/mine`, (route) => {
    state.calls.push('GET access/mine');
    if (mine) return mine(route, state);
    return json(route, { unlocked: state.unlocked });
  });
  await page.route(`**/api/tours/${id}/unlock`, (route) => {
    state.calls.push('POST unlock');
    state.bodies.push(route.request().postDataJSON());
    if (unlock) return unlock(route, state);
    state.unlocked = true;
    return json(route, { unlocked: true });
  });
  await page.route(`**/api/tours/${id}/restricted**`, (route) => {
    state.calls.push('GET restricted');
    if (restricted) return restricted(route, state);
    if (!state.unlocked) return json(route, { error: 'Tour không tồn tại hoặc không ở chế độ truy cập hạn chế' }, 404);
    return json(route, { tour: { ...tour, status: 'restricted', restricted: true } });
  });
  return state;
}

test('tester: wrong code, too many tries, then the right code opens the tour', async ({ page }) => {
  await signIn(page, 'tourist');
  let attempt = 0;
  const state = await mockTester(page, {
    unlock: (route, st) => {
      attempt += 1;
      if (attempt === 1) return json(route, { code: 'wrong_passcode', error: 'Mã truy cập không đúng' }, 403);
      if (attempt === 2)
        return json(route, { code: 'too_many_attempts', error: 'Bạn đã nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' }, 429);
      st.unlocked = true;
      return json(route, { unlocked: true });
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tour/${id}/unlock`);
  const field = page.getByLabel('Mã truy cập');
  const open = page.getByRole('button', { name: 'Mở khoá' });
  await open.click();
  await expect(page.getByText('Vui lòng nhập mã truy cập')).toBeVisible();
  expect(state.calls).not.toContain('POST unlock');
  await noOverflow(page);

  await field.fill('sai-ma-123');
  await open.click();
  await expect(page.getByText('Mã truy cập không đúng')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await open.click();
  await expect(page.getByRole('alert').filter({ hasText: 'thử lại sau 15 phút' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/tour/${id}/unlock$`));

  await field.fill('dung-ma-123');
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/tour/${id}/restricted$`));
  expect(state.bodies.at(-1)).toEqual({ passcode: 'dung-ma-123' });
  await expect(page.getByRole('heading', { name: tour.title })).toBeVisible();
  await expect(page.getByText('Bản thử nghiệm (truy cập hạn chế)')).toBeVisible();
  // No itinerary add for a tour that is not public; play links use the restricted player.
  await expect(page.getByRole('button', { name: /vào lịch trình/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Điểm đầu tiên/ })).toHaveAttribute('href', new RegExp(`/tour/${id}/restricted/play\\?`));
  await noOverflow(page);
});

test('tester already unlocked goes straight to the content; the player uses the restricted view', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockTester(page, { unlocked: true });
  await page.goto(`/tour/${id}/unlock`);
  await expect(page).toHaveURL(new RegExp(`/tour/${id}/restricted$`));
  await expect(page.getByRole('heading', { name: tour.title })).toBeVisible();
  await expect(page.getByLabel('Mã truy cập')).toHaveCount(0);
  const before = state.calls.filter((c) => c === 'GET restricted').length;
  await page.goto(`/tour/${id}/restricted/play?mode=remote`);
  await expect.poll(() => state.calls.filter((c) => c === 'GET restricted').length).toBeGreaterThan(before);
  await expect(page.getByText(tour.title).first()).toBeVisible();
});

test('lost access (passcode changed) sends the tester back to the unlock form', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockTester(page, { unlocked: false });
  await page.goto(`/tour/${id}/restricted`);
  await expect(page).toHaveURL(new RegExp(`/tour/${id}/unlock$`));
  await expect(page.getByText('Mã truy cập đã thay đổi')).toBeVisible();
  await expect(page.getByLabel('Mã truy cập')).toBeVisible();
});

test('a tour that is not restricted shows a notice', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockTester(page, {
    mine: (route) => json(route, { error: 'Tour không tồn tại hoặc không ở chế độ truy cập hạn chế' }, 404),
  });
  await page.goto(`/tour/${id}/unlock`);
  await expect(page.getByText('Tour không tồn tại hoặc không ở chế độ truy cập hạn chế')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mở khoá' })).toHaveCount(0);
});

test('access check failure shows retry', async ({ page }) => {
  await signIn(page, 'tourist');
  let fail = true;
  await mockTester(page, { mine: (route) => (fail ? route.abort('failed') : json(route, { unlocked: false })) });
  await page.goto(`/tour/${id}/unlock`);
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByLabel('Mã truy cập')).toBeVisible();
});

test('guest is sent to login with next', async ({ page }) => {
  const state = await mockTester(page);
  await page.goto(`/tour/${id}/unlock`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Ftour%2F${id}%2Funlock`));
  await page.goto(`/tour/${id}/restricted`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Ftour%2F${id}%2Frestricted`));
  expect(state.calls).toHaveLength(0);
});
