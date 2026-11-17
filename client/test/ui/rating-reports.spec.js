import { test, expect } from '@playwright/test';
import { fixtures, id, json, signIn } from './fixtures.js';

test('tourist can report another rating on tour detail', async ({ page }) => {
  await fixtures(page);
  await signIn(page, 'tourist', '55555555-5555-4555-8555-555555555555');
  let reportedBody = null;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === `/api/tours/${id}/ratings`) {
      return json(route, {
        summary: { averageRating: 4, ratingCount: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } },
        items: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            userName: 'Người dùng khác',
            stars: 4,
            comment: 'Spam quảng cáo',
            createdAt: '2026-11-17T08:00:00Z',
            updatedAt: '2026-11-17T08:00:00Z',
          },
        ],
        page: 1,
        limit: 10,
        total: 1,
      });
    }
    if (u.pathname === `/api/tours/${id}/ratings/99999999-9999-4999-8999-999999999999/reports` && req.method() === 'POST') {
      reportedBody = req.postDataJSON();
      return json(route, { report: { id: 'rep-1' }, pendingCount: 1, isFlagged: false }, 201);
    }
    return route.fallback();
  });

  await page.goto(`/tour/${id}#ratings`);
  await page.getByRole('button', { name: 'Báo cáo vi phạm' }).click();
  await page.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(page.getByText('Báo cáo của bạn đã được gửi và đang chờ quản trị viên xem xét.')).toBeVisible();
  expect(reportedBody?.reasonType).toBe('SPAM');
});
