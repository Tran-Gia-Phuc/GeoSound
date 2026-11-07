// UC15: submit a tour for review — checklist + "Gửi duyệt" (#109), AI pass (#110), AI warning (#111),
// rejection / admin decisions (#112), forbidden zone details (#113), long-running AI check with polling
// (#114) and place moderation chips (#137). Every API route is mocked.
import { test, expect } from '@playwright/test';
import { id, secondId, tour, json, signIn, fixtures, noOverflow } from './fixtures.js';

const placeA = { id: secondId, tourId: id, name: 'Chùa Cầu', type: 'landmark', description: 'Mô tả A', lat: 15.877, lng: 108.327, sequence: 0, images: [], audioUrl: null, audioSource: 'tts', moderationStatus: 'approved', moderationReasons: [] };
const placeB = { ...placeA, id: '44444444-4444-4444-8444-444444444444', name: 'Hội quán Phúc Kiến', sequence: 1 };
const placeC = { ...placeA, id: '55555555-5555-4555-8555-555555555555', name: 'Nhà cổ Tấn Ký', sequence: 2 };
const placeD = { ...placeA, id: '66666666-6666-4666-8666-666666666666', name: 'Chợ Hội An', sequence: 3 };

const baseChecks = [
  { key: 'title', label: 'Có tên tour', required: true, ok: true },
  { key: 'language', label: 'Có ngôn ngữ gốc', required: true, ok: true },
  { key: 'places', label: 'Có ít nhất một điểm dừng', required: true, ok: true },
  { key: 'placeDescriptions', label: 'Mọi điểm dừng đều có mô tả', required: true, ok: true },
];
const moderationOk = { key: 'placesModeration', label: 'Mọi điểm dừng đã qua kiểm duyệt AI', required: true, ok: true };
const limitOk = { key: 'placesLimit', label: 'Tối đa 50 điểm dừng', required: true, ok: true };

/**
 * Mocks the Studio routes of one tour. GET /mine/:id returns `state.current` when a test set it,
 * else the `tours` sequence (the last one repeats); `state.fail` makes it answer 503. GET places
 * returns `state.places`. Returns the state object with call counters.
 */
async function mockStudio(page, {
  tours = [tour],
  moderation = true,
  checks,
  places = [placeA, placeB],
  publish,
  addPlace,
} = {}) {
  const state = { tourCalls: 0, placesCalls: 0, publishCalls: 0, readinessCalls: 0, current: null, fail: false, places };
  await fixtures(page);
  await page.route(`**/api/tours/mine/${id}`, (route) => {
    const i = state.tourCalls;
    state.tourCalls += 1;
    if (state.fail) return json(route, { error: 'Dịch vụ tour đang bận' }, 503);
    const t = state.current ?? tours[Math.min(i, tours.length - 1)];
    return json(route, { tour: t });
  });
  await page.route(`**/api/tours/mine/${id}/readiness`, (route) => {
    state.readinessCalls += 1;
    const list = checks ?? (moderation ? [...baseChecks, moderationOk, limitOk] : baseChecks);
    const required = list.filter((c) => c.required);
    return json(route, {
      readiness: {
        status: tours[0].status,
        canPublish: true,
        placeCount: places.length,
        ready: required.every((c) => c.ok),
        checks: list,
      },
    });
  });
  await page.route(`**/api/tours/mine/${id}/places`, (route) => {
    if (route.request().method() === 'POST') return addPlace ? addPlace(route) : json(route, { place: placeC }, 201);
    state.placesCalls += 1;
    return json(route, { places: state.places });
  });
  await page.route(`**/api/tours/mine/${id}/publish`, (route) => {
    state.publishCalls += 1;
    return publish ? publish(route) : json(route, { tour: { ...tour, status: 'ai_checking' } });
  });
  await page.route(`**/api/tours/mine/${id}/access`, (route) =>
    json(route, { restricted: false, passcodeSetAt: null, testers: 0 }),
  );
  return state;
}

const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const submission = (page) => page.locator('section.submission');
const settle = (page) => page.waitForTimeout(300); // let in-flight mocked requests finish (real time)

/** Fake clock: start before `pauseAt`, load the page, then freeze at `pauseAt` (timers run only on runFor). */
async function frozenClock(page, pauseAt, path, ready) {
  await page.clock.install({ time: new Date(Date.parse(pauseAt) - 60 * 60 * 1000) });
  await page.goto(path);
  await ready();
  await page.clock.pauseAt(new Date(pauseAt));
  await settle(page);
}

const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test('#109 direct mode keeps "Xuất bản" (no moderation check from the server)', async ({ page }) => {
  await signIn(page);
  const state = await mockStudio(page, {
    moderation: false,
    publish: (route) => json(route, { tour: { ...tour, status: 'public' } }),
  });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(page.getByRole('heading', { name: 'Sẵn sàng xuất bản?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Xuất bản' }).click();
  await expect(page.getByText('Đã xuất bản! Khách có thể tìm thấy tour ở Khám phá.')).toBeVisible();
  expect(state.publishCalls).toBe(1);
});

test('#109 moderation mode: checklist, confirmation, then "Gửi duyệt" sends the tour to AI', async ({ page }) => {
  await signIn(page);
  const checking = { ...tour, status: 'ai_checking', updatedAt: new Date().toISOString() };
  const state = await mockStudio(page, {
    publish: (route) => {
      state.current = checking; // the server now reports the tour as being checked
      return json(route, { tour: checking });
    },
  });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(page.getByRole('heading', { name: 'Sẵn sàng gửi duyệt?' })).toBeVisible();
  await expect(page.getByText('Mọi điểm dừng đã qua kiểm duyệt AI')).toBeVisible();
  await expect(page.getByText('6/6 mục bắt buộc')).toBeVisible();
  await expect(page.locator('.stepper')).toContainText('Gửi duyệt');
  await expect(page.getByRole('button', { name: 'Xuất bản' })).toHaveCount(0);

  // Cancel the confirmation: nothing is sent.
  await page.getByRole('button', { name: 'Gửi duyệt' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Gửi “Chuyện phố cổ” đi duyệt?');
  await dialog.getByRole('button', { name: 'Huỷ' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.publishCalls).toBe(0);

  await page.getByRole('button', { name: 'Gửi duyệt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gửi duyệt' }).click();
  await expect(toast(page, 'Đã gửi tour cho AI kiểm duyệt')).toBeVisible();
  await expect(submission(page)).toContainText('AI đang kiểm duyệt tour');
  await expect(page.getByRole('heading', { name: 'Tour đang được duyệt' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Gửi duyệt/ })).toHaveCount(0);
  // Never a success claim before the server reports a result.
  await expect(page.getByText('Đã gửi duyệt thành công')).toHaveCount(0);
  expect(state.publishCalls).toBe(1);
});

test('#109 missing items from the server are listed with a fix link', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, {
    checks: [
      baseChecks[0],
      baseChecks[1],
      baseChecks[2],
      { key: 'placeDescriptions', label: 'Điểm chưa có mô tả: Chùa Cầu', required: true, ok: false },
      moderationOk,
      limitOk,
    ],
  });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(page.getByText('Điểm chưa có mô tả: Chùa Cầu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled();
  await expect(page.locator('.checklist__item.is-missing').getByRole('link', { name: 'Thêm / sửa điểm dừng' })).toHaveAttribute(
    'href',
    `/studio/tours/${id}/places`,
  );
});

test('#109 / D5: places being checked or rejected block the submit, with links to fix them', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, {
    checks: [
      ...baseChecks,
      { key: 'placesModeration', label: 'Điểm đang được AI kiểm duyệt: Chùa Cầu; Điểm bị AI từ chối, cần sửa: Hội quán Phúc Kiến', required: true, ok: false },
      limitOk,
    ],
    places: [
      { ...placeA, moderationStatus: 'checking' },
      { ...placeB, moderationStatus: 'rejected' },
      { ...placeC, moderationStatus: 'warning' },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/publish`);
  const blocking = page.getByRole('group', { name: 'Điểm dừng cần xử lý trước khi gửi duyệt' });
  await expect(blocking).toContainText('Chùa Cầu');
  await expect(blocking).toContainText('AI đang kiểm duyệt');
  await expect(blocking).toContainText('Bị AI từ chối');
  await expect(blocking.getByRole('link', { name: 'Sửa “Hội quán Phúc Kiến”' })).toHaveAttribute(
    'href',
    `/studio/tours/${id}/places?edit=${placeB.id}`,
  );
  await expect(page.getByText(/1 điểm có cảnh báo AI \(Nhà cổ Tấn Ký\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled();
  await noOverflow(page);
});

test('#110 AI pass: "Đang chờ Admin duyệt", no submit action', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, { tours: [{ ...tour, status: 'pending_review' }] });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(submission(page)).toContainText('Đang chờ Admin duyệt');
  await expect(submission(page)).toContainText('AI không phát hiện vấn đề');
  await expect(page.getByRole('button', { name: /Gửi duyệt|Xuất bản/ })).toHaveCount(0);
  await expect(page.locator('.stepper')).toContainText('Đang duyệt');
});

test('#111 AI warning: reasons with field, category, message and source (AI / geo with place link)', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, {
    tours: [
      {
        ...tour,
        status: 'ai_warning',
        moderationReasons: [
          { field: 'title', category: 'misleading', message: 'Tiêu đề hứa hẹn quá mức.', source: 'ai', severity: 0.5 },
          { field: 'places[1]', category: 'route', message: 'Điểm dừng cách điểm trước quá xa. (placeId 44444444-4444-4444-8444-444444444444)', source: 'geo', severity: 0.5 },
        ],
      },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/publish`);
  const s = submission(page);
  await expect(s).toContainText('Đang chờ Admin duyệt — có cảnh báo AI');
  const reasons = s.getByRole('list', { name: 'Lý do kiểm duyệt AI' }).locator('li');
  await expect(reasons).toHaveCount(2);
  await expect(reasons.nth(0)).toContainText('Tên tour');
  await expect(reasons.nth(0)).toContainText('Thông tin sai lệch');
  await expect(reasons.nth(0)).toContainText('AI');
  await expect(reasons.nth(0)).toContainText('Tiêu đề hứa hẹn quá mức.');
  await expect(reasons.nth(1)).toContainText('Điểm dừng 2');
  await expect(reasons.nth(1)).toContainText('Lộ trình, vị trí');
  await expect(reasons.nth(1)).toContainText('Kiểm tra vị trí');
  await expect(reasons.nth(1)).not.toContainText('placeId');
  await expect(reasons.nth(1)).toContainText('Hội quán Phúc Kiến');
  await expect(reasons.nth(1).getByRole('link', { name: 'Sửa điểm này' })).toHaveAttribute(
    'href',
    `/studio/tours/${id}/places?edit=${placeB.id}`,
  );
  await noOverflow(page);
});

test('#112 AI rejection: back to draft with reasons, edit links and "Gửi duyệt lại"', async ({ page }) => {
  await signIn(page);
  const rejected = {
    ...tour,
    status: 'draft',
    moderationReasons: [{ field: 'description', category: 'scam', message: 'Mô tả quảng cáo dịch vụ trả phí.', source: 'ai', severity: 0.9 }],
  };
  await mockStudio(page, { tours: [rejected] });
  await page.goto(`/studio/tours/${id}/publish`);
  const s = submission(page);
  await expect(s).toContainText('AI đã từ chối lần gửi duyệt trước');
  await expect(s).toContainText('Lừa đảo, quảng cáo');
  await expect(s).toContainText('Mô tả quảng cáo dịch vụ trả phí.');
  await expect(s.getByRole('link', { name: 'Sửa thông tin tour' })).toHaveAttribute('href', `/studio/tours/${id}`);
  await expect(s.getByRole('link', { name: 'Sửa điểm dừng' })).toHaveAttribute('href', `/studio/tours/${id}/places`);
  await expect(page.getByRole('button', { name: 'Gửi duyệt lại' })).toBeEnabled();

  // The info step points the author to the reasons.
  await page.goto(`/studio/tours/${id}`);
  await expect(page.getByText('AI đã từ chối lần gửi duyệt trước.')).toBeVisible();
  await page.getByRole('link', { name: 'Xem lý do' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/tours/${id}/publish$`));
});

test('#112 admin decisions: changes requested and rejected show the admin reason', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, { tours: [{ ...tour, status: 'changes_requested', reviewReason: 'Bổ sung nguồn tư liệu cho điểm 2.' }] });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(submission(page)).toContainText('Admin yêu cầu chỉnh sửa');
  await expect(submission(page)).toContainText('Bổ sung nguồn tư liệu cho điểm 2.');
  await expect(page.locator('.statuschip').first()).toHaveText('Cần chỉnh sửa');
  await expect(page.getByRole('button', { name: 'Gửi duyệt lại' })).toBeEnabled();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockStudio(page, { tours: [{ ...tour, status: 'rejected', reviewReason: 'Nội dung trùng tour khác.' }] });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(submission(page)).toContainText('Admin đã từ chối tour');
  await expect(submission(page)).toContainText('Nội dung trùng tour khác.');
  await expect(page.getByRole('button', { name: 'Gửi duyệt lại' })).toBeEnabled();
});

test('#114 long AI check: polls every 5 s, shows elapsed time, stops after the result', async ({ page }) => {
  await signIn(page);
  const state = await mockStudio(page, { tours: [{ ...tour, status: 'ai_checking', updatedAt: '2026-11-08T10:00:00.000Z' }] });
  await frozenClock(page, '2026-11-08T10:01:04Z', `/studio/tours/${id}/publish`, () =>
    expect(submission(page)).toContainText('AI đang kiểm duyệt tour'),
  );
  await page.clock.runFor(1000);
  await expect(page.getByTestId('elapsed')).toHaveText('1 phút 05 giây');
  await settle(page);

  const base = state.tourCalls;
  await page.clock.runFor(5000);
  await expect.poll(() => state.tourCalls).toBe(base + 1);
  await expect(page.getByTestId('elapsed')).toHaveText('1 phút 10 giây');
  await expect(submission(page)).toContainText('AI đang kiểm duyệt tour');
  await expect(page.getByText('Đã gửi duyệt thành công')).toHaveCount(0);

  state.current = { ...tour, status: 'pending_review', updatedAt: '2026-11-08T10:01:12.000Z' };
  await page.clock.runFor(5000);
  await expect(submission(page)).toContainText('Đang chờ Admin duyệt');
  await expect(toast(page, 'Đã gửi duyệt thành công. Tour đang chờ Admin duyệt.')).toBeVisible();
  await expect(page.getByTestId('elapsed')).toHaveCount(0);
  await settle(page);
  const settled = state.tourCalls;
  await page.clock.runFor(20000);
  await settle(page);
  expect(state.tourCalls).toBe(settled);
});

test('#114 polling pauses while the page is hidden and resumes when visible', async ({ page }) => {
  await signIn(page);
  const state = await mockStudio(page, { tours: [{ ...tour, status: 'ai_checking', updatedAt: '2026-11-08T10:00:00.000Z' }] });
  await frozenClock(page, '2026-11-08T10:00:10Z', `/studio/tours/${id}/publish`, () =>
    expect(submission(page)).toContainText('AI đang kiểm duyệt tour'),
  );
  await setHidden(page, true);
  const base = state.tourCalls;
  await page.clock.runFor(20000);
  await settle(page);
  expect(state.tourCalls).toBe(base);

  await setHidden(page, false);
  await page.clock.runFor(10);
  await expect.poll(() => state.tourCalls).toBe(base + 1); // polls right away when visible again
  await settle(page);
  await page.clock.runFor(5000);
  await expect.poll(() => state.tourCalls).toBe(base + 2);
});

test('#114 a failed poll shows "Thử lại" and keeps the AI-checking state', async ({ page }) => {
  await signIn(page);
  const state = await mockStudio(page, { tours: [{ ...tour, status: 'ai_checking', updatedAt: '2026-11-08T10:00:00.000Z' }] });
  await frozenClock(page, '2026-11-08T10:00:10Z', `/studio/tours/${id}/publish`, () =>
    expect(submission(page)).toContainText('AI đang kiểm duyệt tour'),
  );
  state.fail = true;
  await page.clock.runFor(5000);
  await expect(page.getByText('Chưa cập nhật được trạng thái: Dịch vụ tour đang bận')).toBeVisible();
  await expect(submission(page)).toContainText('AI đang kiểm duyệt tour');
  const failed = state.tourCalls;
  await page.clock.runFor(15000);
  await settle(page);
  expect(state.tourCalls).toBe(failed); // stopped after the failure

  state.fail = false;
  state.current = {
    ...tour,
    status: 'ai_warning',
    moderationReasons: [{ field: 'coherence', category: 'irrelevant', message: 'Một điểm không liên quan chủ đề.', source: 'ai' }],
  };
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await page.clock.runFor(10);
  await expect(submission(page)).toContainText('Đang chờ Admin duyệt — có cảnh báo AI');
  await expect(submission(page)).toContainText('Tính nhất quán của tour');
  await expect(submission(page)).toContainText('Không liên quan');
  await expect(toast(page, 'AI có cảnh báo')).toBeVisible();
});

test('#114 a long wait explains that the AI is busy', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, { tours: [{ ...tour, status: 'ai_checking', updatedAt: '2026-11-08T10:00:00.000Z' }] });
  await frozenClock(page, '2026-11-08T10:02:59Z', `/studio/tours/${id}/publish`, () =>
    expect(submission(page)).toContainText('AI đang kiểm duyệt tour'),
  );
  await page.clock.runFor(1000);
  await expect(page.getByTestId('elapsed')).toHaveText('3 phút 00 giây');
  await expect(page.getByText(/AI đang bận, hệ thống sẽ tự thử lại/)).toBeVisible();
});

test('#113 forbidden zone: place save shows the zone name and type', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, {
    addPlace: (route) =>
      json(
        route,
        {
          error: 'Vị trí nằm trong vùng cấm (Doanh trại K9), vui lòng dời ra ngoài',
          code: 'forbidden_zone',
          zone: { name: 'Doanh trại K9', type: 'military', geometry: { type: 'Polygon', coordinates: [[[108.32, 15.87], [108.33, 15.87], [108.33, 15.88], [108.32, 15.87]]] } },
        },
        422,
      ),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/tours/${id}/places`);
  await page.getByRole('button', { name: 'Thêm điểm' }).first().click();
  const form = page.locator('form.place-form');
  await form.getByLabel('Tên địa điểm *').fill('Điểm mới');
  await form.getByLabel(/Mô tả \*/).fill('Mô tả điểm mới');
  await form.getByText('Nhập toạ độ thủ công').click();
  await form.getByLabel('Vĩ độ (lat)').fill('15.875');
  await form.getByLabel('Kinh độ (lng)').fill('108.325');
  await form.getByRole('button', { name: 'Thêm điểm' }).click();
  const alert = page.getByRole('alert', { name: 'Vị trí nằm trong vùng cấm' });
  await expect(alert).toContainText('Doanh trại K9');
  await expect(alert).toContainText('Khu quân sự');
  await expect(alert).toContainText('Kéo ghim ra ngoài vùng này');
  await noOverflow(page);
});

test('#113 forbidden zone returned by the submit is shown too', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, {
    publish: (route) =>
      json(route, { error: 'Vị trí nằm trong vùng cấm (Bệnh viện C)', code: 'forbidden_zone', zone: { name: 'Bệnh viện C', type: 'hospital' } }, 422),
  });
  await page.goto(`/studio/tours/${id}/publish`);
  await page.getByRole('button', { name: 'Gửi duyệt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gửi duyệt' }).click();
  const alert = page.getByRole('alert', { name: 'Vị trí nằm trong vùng cấm' });
  await expect(alert).toContainText('Bệnh viện C');
  await expect(alert).toContainText('Bệnh viện');
  await expect(page.getByText('Đã gửi tour cho AI kiểm duyệt')).toHaveCount(0);
});

test('#137 place chips in the list and the form, refreshed while places are scanned', async ({ page }) => {
  await signIn(page);
  const rejectedB = {
    ...placeB,
    moderationStatus: 'rejected',
    moderationReasons: [{ field: 'images[0]', category: 'sexual', message: 'Ảnh có nội dung nhạy cảm.', source: 'ai', severity: 0.9 }],
  };
  const state = await mockStudio(page, {
    places: [{ ...placeA, moderationStatus: 'checking' }, rejectedB, { ...placeC, moderationStatus: 'warning' }, placeD],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const stops = page.locator('.studio-stops > li');
  await frozenClock(page, '2026-11-08T10:00:00Z', `/studio/tours/${id}/places`, () => expect(stops).toHaveCount(4));
  await expect(stops.nth(0).locator('.modchip')).toHaveText('AI đang kiểm duyệt');
  await expect(stops.nth(1).locator('.modchip')).toHaveText('Bị AI từ chối');
  await expect(stops.nth(2).locator('.modchip')).toHaveText('Cảnh báo AI');
  await expect(stops.nth(3).locator('.modchip')).toHaveText('Đã qua kiểm duyệt');
  await noOverflow(page);

  const base = state.placesCalls;
  await page.clock.runFor(5000);
  await expect.poll(() => state.placesCalls).toBe(base + 1); // still scanning: polls again
  await settle(page);
  state.places = [{ ...placeA, moderationStatus: 'approved' }, ...state.places.slice(1)];
  await page.clock.runFor(5000);
  await expect(stops.nth(0).locator('.modchip')).toHaveText('Đã qua kiểm duyệt');
  await settle(page);
  const settled = state.placesCalls;
  await page.clock.runFor(15000);
  await settle(page);
  expect(state.placesCalls).toBe(settled); // nothing left to scan: polling stopped

  await stops.nth(1).locator('.stop__main').click();
  const mod = page.getByRole('status', { name: 'Kiểm duyệt AI của điểm' });
  await expect(mod).toContainText('Bị AI từ chối');
  await expect(mod).toContainText('Ảnh 1');
  await expect(mod).toContainText('Nội dung nhạy cảm');
  await expect(mod).toContainText('Ảnh có nội dung nhạy cảm.');
  await noOverflow(page);
});

test('#137 direct mode hides the default "approved" chip', async ({ page }) => {
  await signIn(page);
  await mockStudio(page, { moderation: false });
  await page.goto(`/studio/tours/${id}/places`);
  await expect(page.locator('.studio-stops > li')).toHaveCount(2);
  await expect(page.locator('.modchip')).toHaveCount(0);
});

test('390 px: AI-checking and rejection states fit the phone', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStudio(page, {
    tours: [{ ...tour, status: 'changes_requested', reviewReason: 'x'.repeat(300), moderationReasons: [{ field: 'description', category: 'hate', message: 'y'.repeat(400), source: 'ai' }] }],
  });
  await page.goto(`/studio/tours/${id}/publish`);
  await expect(submission(page)).toContainText('Admin yêu cầu chỉnh sửa');
  await noOverflow(page);
});
