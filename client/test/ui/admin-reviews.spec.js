// UC19 (#243, Frontend A #122 to #126): admin review queue, read-only dossier and decisions.
import { test, expect } from '@playwright/test';
import { json, signIn, fixtures, noOverflow, id, secondId, userId } from './fixtures.js';

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const authorId = '44444444-4444-4444-8444-444444444444';
const placeA = '55555555-5555-4555-8555-555555555555';
const placeB = '66666666-6666-4666-8666-666666666666';

const queue = {
  tours: [
    {
      id, title: 'Phố cổ có cảnh báo AI', coverImageUrl: null, originalLanguage: 'vi', type: 'walking', city: 'Hội An',
      status: 'ai_warning', aiWarning: true, authorId, submittedAt: hoursAgo(2),
      moderationReasons: [
        { field: 'description', category: 'misleading', message: 'Mô tả có thể sai sự thật', source: 'ai', severity: 0.55 },
        { field: 'route', category: 'route', message: 'Hai điểm cách nhau quá xa', source: 'geo', severity: 0.5 },
      ],
    },
    {
      id: secondId, title: 'Tour chờ duyệt bình thường', coverImageUrl: null, originalLanguage: 'vi', type: 'driving', city: 'Huế',
      status: 'pending_review', aiWarning: false, authorId, submittedAt: hoursAgo(30), moderationReasons: [],
    },
  ],
};

const dossier = (over = {}) => ({
  tour: {
    id, title: 'Phố cổ có cảnh báo AI', description: 'Mô tả tour phố cổ', coverImageUrl: null, originalLanguage: 'vi',
    type: 'walking', status: 'ai_warning', aiWarning: true, authorId, city: 'Hội An', duration: 45,
    moderationReasons: queue.tours[0].moderationReasons, reviewReason: null, updatedAt: hoursAgo(2),
  },
  reviewable: true,
  places: [
    {
      id: placeA, tourId: id, name: 'Chùa Cầu', type: 'historical', description: 'Biểu tượng của Hội An.', lat: 15.877, lng: 108.326,
      sequence: 0, images: [{ url: 'https://img.example.test/a.jpg', caption: 'Chùa Cầu buổi sáng' }],
      audioUrl: 'https://media.example.test/a.mp3', audioSource: 'human', moderationStatus: 'warning',
      moderationReasons: [{ field: 'images[0]', category: 'irrelevant', message: 'Ảnh không khớp địa điểm', source: 'ai', severity: 0.45 }],
    },
    {
      id: placeB, tourId: id, name: 'Hội quán Phúc Kiến', type: 'museum', description: 'Hội quán cổ.', lat: 15.878, lng: 108.328,
      sequence: 1, images: [], audioUrl: null, audioSource: 'tts', moderationStatus: 'approved', moderationReasons: [],
    },
  ],
  routeConfig: {
    tourId: id, path: [{ lat: 15.877, lng: 108.326 }, { lat: 15.8775, lng: 108.327 }, { lat: 15.878, lng: 108.328 }],
    triggers: [{ placeId: placeA, zone: { shape: 'circle', center: { lat: 15.877, lng: 108.326 }, radiusMeters: 40 }, priority: 1 }],
    navAudios: [], updatedAt: hoursAgo(3),
  },
  history: [
    { id: 'h1', tourId: id, adminId: userId, action: 'request_changes', reason: 'Thiếu ảnh điểm 2', fromStatus: 'pending_review', createdAt: hoursAgo(48) },
  ],
  ...over,
});

/** Mocks the admin review API; `handlers[key](route, body)` overrides one call. */
async function mockReviews(page, handlers = {}) {
  const calls = [];
  await fixtures(page);
  await page.route('**/api/tours/admin/reviews**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const tail = u.pathname.replace('/api/tours/admin/reviews', '');
    const key = tail === '' || tail === '/' ? 'queue' : tail.split('/')[2] || 'dossier';
    calls.push({ key, method: req.method(), path: u.pathname, body, auth: req.headers().authorization });
    if (handlers[key]) return handlers[key](route, body);
    if (key === 'queue') return json(route, queue);
    if (key === 'dossier') return json(route, dossier());
    return json(route, { message: 'OK' });
  });
  return calls;
}

test('non-admin sees a notice and the review API is not called', async ({ page }) => {
  await signIn(page, 'contributor');
  const calls = await mockReviews(page);
  await page.goto('/admin/reviews');
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  await page.goto(`/admin/reviews/${id}`);
  await expect(page.getByRole('alert')).toContainText('Chỉ quản trị viên');
  expect(calls).toHaveLength(0);
});

test('queue keeps the API order with status chip, AI reason count and submitted time', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReviews(page);
  await page.goto('/admin/reviews');
  const rows = page.getByTestId('review-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Phố cổ có cảnh báo AI');
  await expect(rows.nth(0)).toContainText('AI Warning');
  await expect(rows.nth(0)).toContainText('2 lý do AI');
  await expect(rows.nth(0)).toContainText('Hội An');
  await expect(rows.nth(0)).toContainText('Gửi lúc');
  await expect(rows.nth(1)).toContainText('Tour chờ duyệt bình thường');
  await expect(rows.nth(1)).toContainText('Chờ duyệt');
  await expect(rows.nth(1).getByTestId('reason-count')).toHaveCount(0);
  await expect(page.getByTestId('queue-summary')).toContainText('2 tour chờ duyệt · 1 có cảnh báo AI');
  expect(calls[0]).toMatchObject({ key: 'queue', method: 'GET', path: '/api/tours/admin/reviews', auth: 'Bearer test-access' });

  await rows.nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/admin/reviews/${id}$`));
});

test('empty queue shows "Không có tour nào chờ duyệt"', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReviews(page, { queue: (route) => json(route, { tours: [] }) });
  await page.goto('/admin/reviews');
  await expect(page.getByText('Không có tour nào chờ duyệt')).toBeVisible();
  await expect(page.getByTestId('review-row')).toHaveCount(0);
});

test('queue error shows the message and "Thử lại" reloads', async ({ page }) => {
  await signIn(page, 'admin');
  let fail = true;
  await mockReviews(page, { queue: (route) => (fail ? json(route, { error: 'Máy chủ đang bận' }, 500) : json(route, queue)) });
  await page.goto('/admin/reviews');
  await expect(page.getByRole('alert')).toContainText('Máy chủ đang bận');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByTestId('review-row')).toHaveCount(2);
});

test('admin nav and the dashboard tile lead to the review queue', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReviews(page);
  await page.route('**/api/tours/admin/dashboard**', (route) =>
    json(route, {
      from: hoursAgo(24 * 7), to: hoursAgo(0), pendingReview: { total: 2, ai_warning: 1, pending_review: 1 },
      averageReviewHours: 0, reportedTours: 0, openReportTours: 0, topContributors: [], actionsByType: {},
    }),
  );
  await page.goto('/admin/dashboard');
  await page.getByTestId('tile-pending').click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByTestId('review-row')).toHaveCount(2);

  await page.goto('/admin');
  const menu = page.getByRole('navigation', { name: 'Màn quản trị' }).getByRole('link');
  await expect(menu.nth(0)).toContainText('Dashboard');
  await expect(menu.nth(1)).toContainText('Duyệt tour');
  await menu.nth(1).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Duyệt tour' })).toHaveClass(/is-active/);
});

test('dossier shows tour info, AI and geo reasons, stops with moderation, route and history (read only)', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReviews(page);
  await page.goto(`/admin/reviews/${id}`);
  const info = page.getByRole('region', { name: 'Thông tin tour' });
  await expect(info).toContainText('Phố cổ có cảnh báo AI');
  await expect(info).toContainText('AI Warning');
  await expect(info).toContainText('Hội An');
  await expect(info).toContainText('2 điểm');
  await expect(page.getByRole('link', { name: 'Xem tài khoản tác giả' })).toHaveAttribute('href', `/admin/users/${authorId}`);

  const reasons = page.getByTestId('tour-reason');
  await expect(reasons).toHaveCount(2);
  await expect(reasons.nth(0)).toContainText('Mô tả');
  await expect(reasons.nth(0)).toContainText('Sai lệch thông tin');
  await expect(reasons.nth(0)).toContainText('Mô tả có thể sai sự thật');
  await expect(reasons.nth(0)).toContainText('Mức độ 55%');
  await expect(reasons.nth(1)).toContainText('Lộ trình');
  await expect(reasons.nth(1)).toContainText('Kiểm tra vị trí');

  const stops = page.getByTestId('review-stop');
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText('Chùa Cầu');
  await expect(stops.nth(0)).toContainText('Cảnh báo AI');
  await expect(stops.nth(0)).toContainText('Biểu tượng của Hội An.');
  await expect(stops.nth(0)).toContainText('Vùng tròn bán kính 40 m');
  await expect(stops.nth(0).getByRole('img', { name: 'Chùa Cầu buổi sáng' })).toHaveAttribute('src', 'https://img.example.test/a.jpg');
  await expect(stops.nth(0).locator('audio')).toHaveAttribute('src', 'https://media.example.test/a.mp3');
  await expect(stops.nth(0).getByRole('link', { name: 'Mở file audio' })).toHaveAttribute('href', 'https://media.example.test/a.mp3');
  await expect(stops.nth(0).getByTestId('place-reason')).toContainText('Ảnh 1');
  await expect(stops.nth(0).getByTestId('place-reason')).toContainText('Không liên quan');
  await expect(stops.nth(1)).toContainText('AI đạt');
  await expect(stops.nth(1)).toContainText('Giọng đọc máy (TTS)');

  await expect(page.getByTestId('route-info')).toContainText('3 điểm trên đường đi · 1 vùng kích hoạt · 0 audio chỉ đường');
  const history = page.getByTestId('history-row');
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText('Yêu cầu chỉnh sửa');
  await expect(history.first()).toContainText('Thiếu ảnh điểm 2');
  await expect(history.first()).toContainText('Chờ duyệt');

  // Read only: no public-only actions and no content editing.
  for (const name of [/Đánh giá/, /Báo cáo/, /lịch trình/i, /Sửa/, /Lưu/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Duyệt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Từ chối' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yêu cầu chỉnh sửa' })).toBeVisible();
});

test('dossier of an unknown tour shows "Không tìm thấy"; a decided tour shows no decision buttons', async ({ page }) => {
  await signIn(page, 'admin');
  let notFound = true;
  await mockReviews(page, {
    dossier: (route) =>
      notFound
        ? json(route, { error: 'Không tìm thấy tour' }, 404)
        : json(route, dossier({ reviewable: false, tour: { ...dossier().tour, status: 'public', aiWarning: false } })),
  });
  await page.goto(`/admin/reviews/${id}`);
  await expect(page.getByRole('alert')).toContainText('Không tìm thấy tour này');
  await expect(page.getByRole('link', { name: 'Về hàng chờ' })).toBeVisible();

  notFound = false;
  await page.reload();
  await expect(page.getByTestId('not-reviewable')).toContainText('Tour không còn ở trạng thái chờ duyệt (hiện tại: Công khai)');
  await expect(page.getByRole('button', { name: 'Duyệt' })).toHaveCount(0);
});

test('approve asks for confirmation, posts, toasts and returns to the queue', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReviews(page, {
    approve: (route) => json(route, { message: 'Đã duyệt tour, tour đã công khai', tour: { id, status: 'public' }, action: 'approve' }),
  });
  await page.goto(`/admin/reviews/${id}`);
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Duyệt tour này?');
  await dialog.getByRole('button', { name: 'Huỷ' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter((c) => c.key === 'approve')).toHaveLength(0);

  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Duyệt và công khai' }).click();
  await expect(page.getByRole('status')).toContainText('Đã duyệt tour, tour đã công khai');
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  expect(calls.find((c) => c.key === 'approve')).toMatchObject({ method: 'POST', path: `/api/tours/admin/reviews/${id}/approve` });
});

test('reject requires a reason (1..1000), then posts the trimmed reason', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReviews(page, {
    reject: (route) => json(route, { message: 'Đã từ chối tour', tour: { id, status: 'rejected' }, action: 'reject' }),
  });
  await page.goto(`/admin/reviews/${id}`);
  await page.getByRole('button', { name: 'Từ chối' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Từ chối tour này?');
  await dialog.getByRole('button', { name: 'Từ chối tour' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập lý do');
  await dialog.getByLabel('Lý do (bắt buộc)').fill('    ');
  await dialog.getByRole('button', { name: 'Từ chối tour' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập lý do');
  await expect(dialog.getByLabel('Lý do (bắt buộc)')).toHaveAttribute('maxlength', '1000');
  expect(calls.filter((c) => c.key === 'reject')).toHaveLength(0);

  await dialog.getByLabel('Lý do (bắt buộc)').fill('  Nội dung sai sự thật  ');
  await dialog.getByRole('button', { name: 'Từ chối tour' }).click();
  await expect(page.getByRole('status')).toContainText('Đã từ chối tour');
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  expect(calls.find((c) => c.key === 'reject')).toMatchObject({
    method: 'POST', path: `/api/tours/admin/reviews/${id}/reject`, body: { reason: 'Nội dung sai sự thật' },
  });
});

test('request changes joins the general note and per-stop notes into one reason', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReviews(page, {
    'request-changes': (route) =>
      json(route, { message: 'Đã yêu cầu tác giả chỉnh sửa tour', tour: { id, status: 'changes_requested' }, action: 'request_changes' }),
  });
  await page.goto(`/admin/reviews/${id}`);
  await page.getByRole('button', { name: 'Yêu cầu chỉnh sửa' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Vui lòng nhập lý do hoặc ghi chú');
  expect(calls.filter((c) => c.key === 'request-changes')).toHaveLength(0);

  await dialog.getByLabel('Lý do chung').fill(' Vui lòng bổ sung nguồn tham khảo ');
  await dialog.getByLabel('Điểm 2 – Hội quán Phúc Kiến').fill(' Thiếu ảnh ');
  await expect(dialog.getByTestId('changes-length')).toContainText('/1000 ký tự');
  await dialog.getByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' }).click();
  await expect(page.getByRole('status')).toContainText('Đã yêu cầu tác giả chỉnh sửa tour');
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  expect(calls.find((c) => c.key === 'request-changes')).toMatchObject({
    method: 'POST',
    path: `/api/tours/admin/reviews/${id}/request-changes`,
    body: { reason: 'Vui lòng bổ sung nguồn tham khảo\nĐiểm 2 – Hội quán Phúc Kiến: Thiếu ảnh' },
  });
});

test('request changes with only a stop note is accepted', async ({ page }) => {
  await signIn(page, 'admin');
  const calls = await mockReviews(page);
  await page.goto(`/admin/reviews/${id}`);
  await page.getByRole('button', { name: 'Yêu cầu chỉnh sửa' }).click();
  await page.getByRole('dialog').getByLabel('Điểm 1 – Chùa Cầu').fill('Ảnh không đúng địa điểm');
  await page.getByRole('dialog').getByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  expect(calls.find((c) => c.key === 'request-changes').body).toEqual({ reason: 'Điểm 1 – Chùa Cầu: Ảnh không đúng địa điểm' });
});

test('a 409 shows "Tour không còn ở trạng thái chờ duyệt" and reloads the dossier', async ({ page }) => {
  await signIn(page, 'admin');
  let decided = false;
  const calls = await mockReviews(page, {
    dossier: (route) =>
      json(route, decided ? dossier({ reviewable: false, tour: { ...dossier().tour, status: 'rejected', aiWarning: false } }) : dossier()),
    approve: (route) => {
      decided = true;
      return json(route, { error: 'Tour vừa được cập nhật bởi thao tác khác, vui lòng tải lại', code: 'tour_not_reviewable' }, 409);
    },
  });
  await page.goto(`/admin/reviews/${id}`);
  await expect(page.getByTestId('review-stop')).toHaveCount(2);
  const before = calls.filter((c) => c.key === 'dossier').length; // StrictMode may load twice
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Duyệt và công khai' }).click();
  await expect(page.getByTestId('dossier-notice')).toContainText('Tour không còn ở trạng thái chờ duyệt');
  await expect(page).toHaveURL(new RegExp(`/admin/reviews/${id}$`));
  await expect.poll(() => calls.filter((c) => c.key === 'dossier').length).toBe(before + 1);
  await expect(page.getByTestId('not-reviewable')).toContainText('Bị từ chối');
  await expect(page.getByRole('button', { name: 'Từ chối' })).toHaveCount(0);
});

test('a 422 is shown inside the reject dialog', async ({ page }) => {
  await signIn(page, 'admin');
  await mockReviews(page, { reject: (route) => json(route, { error: 'Lý do tối đa 1000 ký tự' }, 422) });
  await page.goto(`/admin/reviews/${id}`);
  await page.getByRole('button', { name: 'Từ chối' }).click();
  await page.getByRole('dialog').getByLabel('Lý do (bắt buộc)').fill('abc');
  await page.getByRole('dialog').getByRole('button', { name: 'Từ chối tour' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Lý do tối đa 1000 ký tự');
  await expect(page).toHaveURL(new RegExp(`/admin/reviews/${id}$`));
});

test('queue, dossier and dialogs fit 390 px', async ({ page }) => {
  await signIn(page, 'admin');
  const long = 'Một tiêu đề tour rất dài '.repeat(6);
  await mockReviews(page, {
    queue: (route) => json(route, { tours: [{ ...queue.tours[0], title: long }, queue.tours[1]] }),
    dossier: (route) => {
      const d = dossier();
      return json(route, {
        ...d,
        tour: { ...d.tour, title: long, description: 'Mô tả rất dài '.repeat(40) },
        places: d.places.map((p) => ({ ...p, images: [1, 2, 3, 4, 5].map((n) => ({ url: `https://img.example.test/${n}.jpg` })) })),
      });
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/reviews');
  await expect(page.getByTestId('review-row')).toHaveCount(2);
  await noOverflow(page);
  await page.getByTestId('review-row').first().click();
  await expect(page.getByTestId('review-stop')).toHaveCount(2);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Yêu cầu chỉnh sửa' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await noOverflow(page);
});
