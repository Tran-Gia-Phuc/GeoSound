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

test('failed audio leaves readable content and retry retains stop', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    window.__speechCalls = 0;
    window.speechSynthesis.speak = (u) => {
      window.__speechCalls++;
      if (window.__speechCalls === 1) setTimeout(() => u.onerror?.(), 10);
    };
  });
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  await expect(page.getByRole('button', { name: 'Thử lại âm thanh' })).toBeVisible();
  await expect(page.locator('.sheet__text')).toContainText(places[0].text);
  await page.getByRole('button', { name: 'Thử lại âm thanh' }).click();
  await expect(page.getByRole('button', { name: 'Thử lại âm thanh' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__speechCalls)).toBe(2);
  await expect(page.locator('.sheet__title')).toHaveText(places[0].name);
  await expect(page).toHaveURL(/mode=remote/);
});
