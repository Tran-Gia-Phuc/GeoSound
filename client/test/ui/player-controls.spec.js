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

test('15-second controls remain distinct from stop navigation', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    window.speechSynthesis.speak = () => {};
  });
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  await expect(page.getByRole('button', { name: 'Tua lùi 15 giây' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tua lùi 15 giây' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Điểm trước', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Điểm kế tiếp', exact: true }).click();
  await expect(page.locator('.sheet__title')).toHaveText(places[1].name);
  await expect(page.getByRole('button', { name: 'Điểm trước', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('seek uses real media time in 15-second increments and clamps', async ({ page }) => {
  await fixtures(page);
  const samples = 8000 * 90,
    body = Buffer.alloc(44 + samples * 2);
  body.write('RIFF', 0);
  body.writeUInt32LE(body.length - 8, 4);
  body.write('WAVEfmt ', 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(8000, 24);
  body.writeUInt32LE(16000, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write('data', 36);
  body.writeUInt32LE(samples * 2, 40);
  await page.route('**/seek.wav', (r) => {
    const range = r.request().headers().range;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) return r.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    return r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
  });
  await page.route('**/api/tours/' + id, (r) =>
    json(r, {
      tour: {
        ...tour,
        places: places.map((item) => ({
          ...item,
          audioUrl: 'http://127.0.0.1:5180/seek.wav',
          audioSource: 'human',
        })),
      },
    }),
  );
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  const slider = page.getByRole('slider', { name: 'Tua audio', exact: true });
  await expect(slider).toBeVisible();
  // Issue #155 separately fixes the first-gesture unlock race on develop.
  // Exercise transport after that initial gesture has settled on this branch.
  await page.locator('.topbar').click();
  await page.waitForTimeout(400);
  const pause = page.getByRole('button', { name: 'Tạm dừng', exact: true });
  if (await pause.isVisible()) await pause.click();
  await slider.focus();
  await slider.press('Home');
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(1);
  await page.getByRole('button', { name: 'Tua tới 15 giây' }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(15, 0);
  await page.getByRole('button', { name: 'Tua lùi 15 giây' }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(1);
  await page.getByRole('button', { name: 'Tua lùi 15 giây' }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(0);
});
