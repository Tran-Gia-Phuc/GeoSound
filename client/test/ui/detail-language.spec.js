import { test, expect } from '@playwright/test';
import {
  id,
  secondId,
  userId,
  places,
  tour,
  itinerary,
  library,
  languages,
  json,
  signIn,
  fixtures,
  noOverflow,
  liveRead,
} from './fixtures.js';

test('language failure retains data then retry updates URL and voice', async ({ page }) => {
  await fixtures(page);
  let fail = true;
  await page.route('**/api/tours/' + id + '*', (r) => {
    const lang = new URL(r.request().url()).searchParams.get('lang') || 'vi';
    return lang === 'en' && fail
      ? json(r, { error: 'Language unavailable' }, 503)
      : json(r, {
          tour: { ...tour, selectedLanguage: lang, voiceLabel: lang === 'en' ? 'tts' : 'human' },
        });
  });
  await page.goto('/tour/' + id);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa đổi được ngôn ngữ');
  await expect(page.getByRole('button', { name: 'Tiếng Việt', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: tour.title, exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Thử lại ngôn ngữ' }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Tiếng Việt', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
