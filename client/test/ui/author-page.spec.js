// UC18: public author page, follow / unfollow, profile edit and the following list.
import { test, expect } from '@playwright/test';
import { tour, userId, json, signIn, fixtures, noOverflow } from './fixtures.js';

const aid = '55555555-5555-4555-8555-555555555555';
const author = {
  id: aid,
  fullName: 'Nguyễn Thu Hà',
  avatarUrl: null,
  bio: 'Hướng dẫn viên phố cổ, thích kể chuyện về những ngôi nhà cổ.',
  followerCount: 5,
  joinedAt: '2026-03-15T03:00:00.000Z',
};
const authorTours = Array.from({ length: 14 }, (_, i) => ({
  ...tour,
  id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
  title: `Tour của Hà ${i + 1}`,
  status: 'public',
}));

/** Mocks the author, the follow state and the author's public tours. */
async function mockAuthor(page, { a = author, tours = authorTours, following = false, follow, authorStatus } = {}) {
  const state = { following, count: a?.followerCount ?? 0, calls: [] };
  await fixtures(page);
  await page.route(
    (url) => url.pathname === '/api/tours' && url.searchParams.has('authorId'),
    (route) => {
      const u = new URL(route.request().url());
      state.calls.push(`GET tours ${u.search}`);
      const p = Number(u.searchParams.get('page') || 1);
      const limit = Number(u.searchParams.get('limit') || 12);
      return json(route, { tours: tours.slice((p - 1) * limit, p * limit), total: tours.length, page: p, limit, sort: 'recent' });
    },
  );
  await page.route(`**/api/auth/authors/${aid}`, (route) => {
    state.calls.push('GET author');
    if (authorStatus) return json(route, { code: 'author_not_found', error: 'Không tìm thấy tác giả' }, authorStatus);
    return json(route, { ...a, followerCount: state.count });
  });
  await page.route(`**/api/auth/authors/${aid}/follow`, async (route) => {
    const method = route.request().method();
    state.calls.push(`${method} follow`);
    if (method !== 'GET' && follow) return follow(route, state, method);
    if (method === 'PUT' && !state.following) {
      state.following = true;
      state.count += 1;
    }
    if (method === 'DELETE' && state.following) {
      state.following = false;
      state.count -= 1;
    }
    return json(route, { following: state.following, followerCount: state.count });
  });
  return state;
}

const toast = (page, text) => page.locator('.toast-region').filter({ hasText: text });
const count = (page) => page.getByTestId('follower-count');

test('author page: profile, public tours with paging, no overflow at 390 px', async ({ page }) => {
  const state = await mockAuthor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/authors/${aid}`);
  await expect(page.getByRole('heading', { name: author.fullName })).toBeVisible();
  await expect(page.getByText(author.bio)).toBeVisible();
  await expect(count(page)).toHaveText('5 người theo dõi');
  await expect(page.getByText('Tham gia tháng 3/2026')).toBeVisible();
  await expect(page.locator('.author-avatar--initials')).toHaveText('N');
  await expect(page.getByText('Tour công khai (14)')).toBeVisible();
  await expect(page.locator('.tour-card')).toHaveCount(12);
  expect(state.calls.some((c) => c.includes('authorId=' + aid) && c.includes('sort=recent'))).toBeTruthy();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Xem thêm' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
  await page.locator('.tour-card').first().click();
  await expect(page).toHaveURL(new RegExp(`/tour/${authorTours[0].id}$`));
});

test('author with an avatar shows the image', async ({ page }) => {
  await mockAuthor(page, { a: { ...author, avatarUrl: 'https://cdn.example.test/a.png' } });
  await page.route('https://cdn.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex') }),
  );
  await page.goto(`/authors/${aid}`);
  await expect(page.locator('img.author-avatar')).toHaveAttribute('src', 'https://cdn.example.test/a.png');
});

test('E1: author without public tours', async ({ page }) => {
  await mockAuthor(page, { tours: [] });
  await page.goto(`/authors/${aid}`);
  await expect(page.getByText('Tác giả chưa có tour công khai')).toBeVisible();
  await expect(page.locator('.tour-card')).toHaveCount(0);
});

test('404: author not found', async ({ page }) => {
  await mockAuthor(page, { authorStatus: 404 });
  await page.goto(`/authors/${aid}`);
  await expect(page.getByText('Không tìm thấy tác giả')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Theo dõi' })).toHaveCount(0);
});

test('guest: follow sends to login and back; no follow request', async ({ page }) => {
  const state = await mockAuthor(page);
  await page.goto(`/authors/${aid}`);
  await page.getByRole('button', { name: 'Theo dõi' }).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fauthors%2F${aid}$`));
  expect(state.calls.filter((c) => c.endsWith('follow'))).toHaveLength(0);
});

test('follow and unfollow move the count at once', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockAuthor(page);
  await page.goto(`/authors/${aid}`);
  await expect(page.getByRole('button', { name: 'Theo dõi' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Theo dõi' }).click();
  await expect(page.getByRole('button', { name: 'Đang theo dõi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(count(page)).toHaveText('6 người theo dõi');
  await expect(toast(page, `Đã theo dõi ${author.fullName}`)).toBeVisible();
  await page.getByRole('button', { name: 'Đang theo dõi' }).click();
  await expect(page.getByRole('button', { name: 'Theo dõi' })).toBeVisible();
  await expect(count(page)).toHaveText('5 người theo dõi');
  expect(state.calls).toEqual(expect.arrayContaining(['GET follow', 'PUT follow', 'DELETE follow']));
});

test('already following reads the state; a failed follow rolls back', async ({ page }) => {
  await signIn(page, 'tourist');
  let release;
  const gate = new Promise((r) => (release = r));
  await mockAuthor(page, {
    following: true,
    follow: async (route) => {
      await gate;
      return route.abort('failed');
    },
  });
  await page.goto(`/authors/${aid}`);
  await expect(page.getByRole('button', { name: 'Đang theo dõi' })).toBeVisible();
  await page.getByRole('button', { name: 'Đang theo dõi' }).click();
  // Optimistic while the request runs…
  await expect(count(page)).toHaveText('4 người theo dõi');
  await expect(page.getByRole('button', { name: 'Theo dõi' })).toBeVisible();
  release();
  // …then rolled back.
  await expect(toast(page, 'Không thể kết nối, vui lòng thử lại')).toBeVisible();
  await expect(count(page)).toHaveText('5 người theo dõi');
  await expect(page.getByRole('button', { name: 'Đang theo dõi' })).toBeVisible();
});

test('own author page: no follow button, a link to edit the profile', async ({ page }) => {
  await signIn(page, 'contributor', aid);
  const state = await mockAuthor(page);
  await page.goto(`/authors/${aid}`);
  await expect(page.getByRole('heading', { name: author.fullName })).toBeVisible();
  await expect(page.getByRole('button', { name: /Theo dõi/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sửa hồ sơ' })).toHaveAttribute('href', '/account/profile');
  expect(state.calls.filter((c) => c.endsWith('follow'))).toHaveLength(0);
});

/** Profile edit: author read, media upload and PATCH /me/profile. */
async function mockProfile(page, { patch } = {}) {
  const state = { bodies: [], uploads: 0 };
  await mockAuthor(page);
  await page.route('**/api/media/uploads**', (route) => {
    state.uploads += 1;
    expect(new URL(route.request().url()).searchParams.get('kind')).toBe('image');
    return json(route, { url: 'http://localhost:8080/api/media/files/images/avatar.png', kind: 'image', contentType: 'image/png', size: 10 }, 201);
  });
  await page.route('**/api/media/files/**', (route) => route.fulfill({ status: 404 }));
  await page.route('**/api/auth/me/profile', (route) => {
    const body = route.request().postDataJSON();
    state.bodies.push(body);
    if (patch) return patch(route, body);
    return json(route, { ...author, bio: body.bio !== undefined ? body.bio : author.bio, fullName: body.fullName ?? author.fullName, avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : author.avatarUrl, email: 'test@example.test', role: 'contributor' });
  });
  return state;
}

test('contributor edits the profile: validation, avatar upload, save and remove', async ({ page }) => {
  await signIn(page, 'contributor', aid);
  const state = await mockProfile(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: 'Hồ sơ tác giả' }).click();
  await expect(page).toHaveURL(/\/account\/profile$/);
  const name = page.getByLabel('Họ tên *');
  const bio = page.getByLabel('Giới thiệu');
  await expect(name).toHaveValue(author.fullName); // from the author page, not the stored user
  await expect(bio).toHaveValue(author.bio);
  await noOverflow(page);

  await name.fill('   ');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByText('Vui lòng nhập họ tên')).toBeVisible();
  await name.fill('x'.repeat(121));
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByText('Họ tên tối đa 120 ký tự')).toBeVisible();
  await name.fill('Hà Nguyễn');
  await bio.fill('y'.repeat(501));
  await expect(page.getByText('501/500 ký tự')).toBeVisible();
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByText('Giới thiệu tối đa 500 ký tự')).toBeVisible();
  expect(state.bodies).toHaveLength(0);

  await bio.fill('  Kể chuyện phố cổ.  ');
  await page.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await expect(page.getByRole('button', { name: 'Gỡ' })).toBeVisible();
  expect(state.uploads).toBe(1);
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(toast(page, 'Đã lưu hồ sơ')).toBeVisible();
  expect(state.bodies[0]).toEqual({
    fullName: 'Hà Nguyễn',
    bio: 'Kể chuyện phố cổ.',
    avatarUrl: '/api/media/files/images/avatar.png',
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('geosound:auth')).user.fullName);
  expect(stored).toBe('Hà Nguyễn');

  // Remove the avatar: only avatarUrl: null is sent.
  await page.getByRole('button', { name: 'Gỡ' }).click();
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect.poll(() => state.bodies.length).toBe(2);
  expect(state.bodies[1]).toEqual({ avatarUrl: null });
});

test('profile: server error is shown; no change sends nothing', async ({ page }) => {
  await signIn(page, 'contributor', aid);
  const state = await mockProfile(page, {
    patch: (route) => json(route, { code: 'validation_error', error: 'Ảnh đại diện không hợp lệ' }, 400),
  });
  await page.goto('/account/profile');
  await expect(page.getByLabel('Họ tên *')).toHaveValue(author.fullName);
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(toast(page, 'Không có thay đổi nào để lưu')).toBeVisible();
  expect(state.bodies).toHaveLength(0);
  await page.getByLabel('Giới thiệu').fill('Mới');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ảnh đại diện không hợp lệ' })).toBeVisible();
});

test('tourist: menu says "Hồ sơ", the form starts from the stored user', async ({ page }) => {
  await signIn(page, 'tourist');
  const state = await mockProfile(page);
  await page.goto('/account');
  await expect(page.getByRole('link', { name: 'Hồ sơ tác giả' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Xem trang tác giả của tôi' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Hồ sơ', exact: true }).click();
  await expect(page.getByLabel('Họ tên *')).toHaveValue('Test contributor');
  await page.getByLabel('Họ tên *').fill('Khách Mới');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(toast(page, 'Đã lưu hồ sơ')).toBeVisible();
  expect(state.bodies[0]).toEqual({ fullName: 'Khách Mới' });
});

test('following list: paging and links to the author page', async ({ page }) => {
  await signIn(page, 'tourist');
  await mockAuthor(page);
  const all = Array.from({ length: 23 }, (_, i) => ({
    ...author,
    id: i === 0 ? aid : `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
    fullName: i === 0 ? author.fullName : `Tác giả ${i}`,
    followedAt: '2026-11-01T00:00:00.000Z',
  }));
  const calls = [];
  await page.route('**/api/auth/me/following**', (route) => {
    const u = new URL(route.request().url());
    calls.push(u.search);
    const p = Number(u.searchParams.get('page'));
    const limit = Number(u.searchParams.get('limit'));
    return json(route, { items: all.slice((p - 1) * limit, p * limit), total: all.length, page: p, limit });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: 'Tác giả đang theo dõi' }).click();
  await expect(page.getByTestId('following-row')).toHaveCount(20);
  await expect(page.getByText('23 tác giả')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Xem thêm' }).click();
  await expect(page.getByTestId('following-row')).toHaveCount(23);
  expect(calls).toContain('?page=1&limit=20');
  expect(calls.at(-1)).toBe('?page=2&limit=20');
  await page.getByTestId('following-row').first().click();
  await expect(page).toHaveURL(new RegExp(`/authors/${aid}$`));
  await expect(page.getByRole('heading', { name: author.fullName })).toBeVisible();
});

test('following list: empty and error with retry', async ({ page }) => {
  await signIn(page, 'tourist');
  await fixtures(page);
  let fail = true;
  await page.route('**/api/auth/me/following**', (route) =>
    fail ? route.abort('failed') : json(route, { items: [], total: 0, page: 1, limit: 20 }),
  );
  await page.goto('/account/following');
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Bạn chưa theo dõi tác giả nào')).toBeVisible();
});

test('profile and following need sign-in', async ({ page }) => {
  await fixtures(page);
  await page.goto('/account/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fprofile/);
  await page.goto('/account/following');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Ffollowing/);
});

test('tour detail links to the author page when the detail has authorId', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/tour/${tour.id}`);
  await expect(page.getByRole('link', { name: 'Xem trang tác giả' })).toHaveAttribute('href', `/authors/${userId}`);
});
