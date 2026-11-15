// Account rating history (/account/ratings): list, star filter, inline edit/delete, and 390px layout.
import { test, expect } from '@playwright/test';
import { id, secondId, json, signIn, fixtures, noOverflow, tour } from './fixtures.js';

function sampleRatings() {
  return [
    {
      id: 'r1',
      tourId: id,
      userName: 'Test contributor',
      stars: 5,
      comment: 'Âm thanh thuyết minh rất truyền cảm.',
      createdAt: '2026-11-10T09:00:00.000Z',
      updatedAt: '2026-11-10T09:00:00.000Z',
      tour: {
        id,
        title: 'Chuyện phố cổ',
        city: 'Hội An',
        coverImageUrl: null,
        status: 'public',
        averageRating: 4.8,
        ratingCount: 12,
      },
    },
    {
      id: 'r2',
      tourId: secondId,
      userName: 'Test contributor',
      stars: 3,
      comment: 'Nội dung ổn nhưng đoạn cuối hơi nhanh.',
      createdAt: '2026-11-08T10:00:00.000Z',
      updatedAt: '2026-11-08T10:00:00.000Z',
      tour: {
        id: secondId,
        title: 'Sài Gòn về đêm',
        city: 'Hồ Chí Minh',
        coverImageUrl: null,
        status: 'public',
        averageRating: 4.2,
        ratingCount: 5,
      },
    },
  ];
}

test('account menu opens My Ratings empty state cleanly', async ({ page }) => {
  await signIn(page, 'tourist');
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/notifications/unread-count') return json(route, { unread: 0 });
    if (u.pathname === '/api/tours/ratings/mine') return json(route, { items: [], page: 1, limit: 10, total: 0 });
    if (u.pathname.startsWith('/api/auth/presence')) return route.fulfill({ status: 204 });
    return json(route, {});
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await page.getByRole('link', { name: /Đánh giá của tôi/ }).click();
  await expect(page).toHaveURL(/\/account\/ratings$/);
  await expect(page.getByText('Bạn chưa đánh giá tour nào')).toBeVisible();
  await noOverflow(page);
});

test('My Ratings supports star filter, inline edit, delete, and 390px responsiveness', async ({ page }) => {
  await signIn(page, 'tourist');
  const items = sampleRatings();
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (u.pathname === '/api/notifications/unread-count') return json(route, { unread: 0 });
    if (u.pathname.startsWith('/api/auth/presence')) return route.fulfill({ status: 204 });
    if (method === 'GET' && u.pathname === '/api/tours/ratings/mine') {
      return json(route, { items, page: 1, limit: 10, total: items.length });
    }
    if (method === 'PUT' && u.pathname === `/api/tours/${id}/ratings/mine`) {
      const body = route.request().postDataJSON();
      items[0] = { ...items[0], stars: body.stars, comment: body.comment, updatedAt: '2026-11-15T12:00:00.000Z' };
      return json(route, { rating: items[0], summary: { averageRating: 4.7, ratingCount: 12 } });
    }
    if (method === 'DELETE' && u.pathname === `/api/tours/${secondId}/ratings/mine`) {
      items.splice(1, 1);
      return route.fulfill({ status: 204 });
    }
    return json(route, {});
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/ratings');

  const cards = page.getByTestId('my-rating-card');
  await expect(cards).toHaveCount(2);
  await expect(page.getByText('Chuyện phố cổ')).toBeVisible();
  await noOverflow(page);

  // Filter by 3 stars
  await page.getByRole('button', { name: /3\s*\(1\)/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByText('Sài Gòn về đêm')).toBeVisible();

  // Reset to all
  await page.getByRole('button', { name: /Tất cả/ }).click();
  await expect(cards).toHaveCount(2);

  // Inline edit first card
  await cards.first().getByRole('button', { name: 'Sửa' }).click();
  await cards.first().getByRole('textbox').fill('Đã cập nhật nhận xét mới.');
  await cards.first().getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã cập nhật nhận xét mới.')).toBeVisible();

  // Inline delete second card
  await cards.nth(1).getByRole('button', { name: 'Xoá' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xoá' }).click();
  await expect(cards).toHaveCount(1);
  await noOverflow(page);
});

test('Discover map renders redesigned gs-pin--v2 markers', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/tours?*', (route) =>
    json(route, { tours: [{ ...tour, anchor: { lat: 15.877, lng: 108.327 } }], total: 1, page: 1, limit: 12 }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?view=map');
  await expect(page.locator('.discovermap .gs-pin--v2')).toHaveCount(1);
});
