// UC04 / UC12 — listening language: automatic translation on request, device language
// suggestion, fallback reason, "Bản dịch tự động" label + original text, missing device voice,
// Studio auto translation switch. The API is mocked (fixtures.js); the browser locale is en-US.
import { test, expect } from '@playwright/test';
import { id, secondId, places, tour, languages, json, signIn, fixtures, noOverflow } from './fixtures.js';

const ALL = ['vi', 'en', 'fr', 'ja', 'ko', 'zh', 'es', 'de', 'th', 'ru'];

/** Tour view in `lang` as buildTourDetailView returns it (vi source, en by the author). */
function view(lang, { asked, auto = [], reason = null } = {}) {
  const available = ['vi', 'en', ...auto];
  const selected = available.includes(lang) ? lang : 'vi';
  const kinds = Object.fromEntries(available.map((c) => [c, c === 'vi' ? 'source' : auto.includes(c) ? 'auto' : 'author']));
  return {
    ...tour,
    selectedLanguage: selected,
    requestedLanguage: asked ?? lang ?? null,
    fallbackReason: reason,
    availableLanguages: available,
    languageKinds: kinds,
    translatableLanguages: ALL.filter((c) => !available.includes(c)),
    autoTranslate: true,
    places: places.map((p) =>
      selected === 'vi'
        ? p
        : { ...p, text: `[${selected}] ${p.text}`, translationKind: kinds[selected], originalText: p.text },
    ),
  };
}

/** Detail + translation routes. `translated` = languages already translated on the server. */
async function tourApi(page, { translated = [], translateStatus = 200 } = {}) {
  const calls = [];
  await page.route((u) => u.pathname === '/api/tours/' + id, (r) => {
    const lang = new URL(r.request().url()).searchParams.get('lang') || undefined;
    const has = !lang || ['vi', 'en', ...translated].includes(lang);
    return json(r, { tour: view(lang, { auto: translated, reason: has ? null : 'not_translated' }) });
  });
  await page.route('**/api/tours/' + id + '/translations/*', (r) => {
    const lang = r.request().url().split('/').pop();
    calls.push(lang);
    if (translateStatus !== 200) return json(r, { error: 'busy', code: 'x' }, translateStatus);
    translated.push(lang);
    return json(r, { tour: view(lang, { auto: translated }) });
  });
  return calls;
}

test('detail: a language the tour lacks is offered, translated on tap, then tagged automatic', async ({ page }) => {
  await fixtures(page);
  const calls = await tourApi(page);
  await page.goto('/tour/' + id + '?lang=de');
  const notice = page.locator('.langnotice');
  await expect(notice).toContainText('Tour chưa có bản Deutsch');
  await notice.getByRole('button', { name: 'Dịch sang Deutsch' }).click();
  await expect(page.getByRole('button', { name: /Deutsch/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Deutsch/ })).toContainText('tự động');
  expect(calls).toEqual(['de']);
  await expect(page).toHaveURL(/lang=de/);
  await noOverflow(page);
});

test('detail: the other-language picker asks for a translation; a busy AI keeps the current language', async ({ page }) => {
  await fixtures(page);
  await tourApi(page, { translateStatus: 503 });
  await page.goto('/tour/' + id);
  await page.getByLabel('Dịch tự động sang ngôn ngữ khác').selectOption('fr');
  await expect(page.locator('.langnotice')).toContainText('Dịch tự động đang bận');
  await expect(page.getByRole('button', { name: 'Tiếng Việt', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('detail: device language suggestion switches, and "Để sau" is remembered', async ({ page }) => {
  await fixtures(page);
  await tourApi(page);
  await page.goto('/tour/' + id);
  const notice = page.locator('.langnotice');
  await expect(notice).toContainText('Tour có bản English');
  await notice.getByRole('button', { name: 'Để sau' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: tour.title, exact: true })).toBeVisible();
  await expect(page.locator('.langnotice')).toHaveCount(0);
});

test('detail: an unsupported or forbidden language says why the source language plays', async ({ page }) => {
  await fixtures(page);
  await page.route((u) => u.pathname === '/api/tours/' + id, (r) =>
    json(r, { tour: { ...view(undefined), requestedLanguage: 'pt', fallbackReason: 'not_supported' } }),
  );
  await page.goto('/tour/' + id + '?lang=pt');
  await expect(page.locator('.langnotice')).toContainText('GeoSound chưa hỗ trợ ngôn ngữ "pt". Đang phát Tiếng Việt.');
});

test('player: the menu offers automatic translation; the stop shows the label and the original text', async ({ page }) => {
  await fixtures(page);
  const calls = await tourApi(page);
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  await page.getByRole('button', { name: 'Đổi ngôn ngữ' }).click();
  await expect(page.locator('.langmenu__label')).toHaveText('Dịch tự động');
  await page.locator('.langmenu__group').nth(1).getByRole('button', { name: 'Deutsch' }).click();
  await expect(page.locator('.sheet__text')).toContainText('[de] ' + places[0].text);
  await expect(page.locator('.sheet__lang')).toContainText('Bản dịch tự động');
  await page.getByRole('button', { name: 'Xem bản gốc' }).click();
  await expect(page.locator('.sheet__text')).toHaveText(places[0].text);
  await page.getByRole('button', { name: 'Xem bản dịch' }).click();
  await expect(page.locator('.sheet__text')).toContainText('[de]');
  expect(calls).toEqual(['de']);
  await expect(page).toHaveURL(/lang=de/);

  await page.getByRole('button', { name: 'Đổi ngôn ngữ' }).click();
  await expect(page.locator('.langmenu__group').first()).toContainText('Tự động');
});

test('player: a failed translation keeps the language and says why', async ({ page }) => {
  await fixtures(page);
  await tourApi(page, { translateStatus: 429 });
  await page.goto('/tour/' + id + '/play?mode=remote&stop=' + secondId);
  await page.getByRole('button', { name: 'Đổi ngôn ngữ' }).click();
  await page.locator('.langmenu__group').nth(1).getByRole('button', { name: 'Français' }).click();
  await expect(page.locator('.banners')).toContainText('Bạn yêu cầu dịch quá nhiều lần');
  await expect(page.locator('.sheet__text')).toHaveText(places[0].text);
});

test('player: no device voice for the language -> the text-only notice', async ({ page }) => {
  await page.addInitScript(() => {
    window.speechSynthesis.getVoices = () => [{ lang: 'vi-VN', name: 'Vietnamese' }];
    window.speechSynthesis.speak = () => {};
  });
  await fixtures(page);
  await tourApi(page);
  await page.goto('/tour/' + id + '/play?mode=remote&lang=en&stop=' + secondId);
  await expect(page.locator('.banners')).toContainText('Máy chưa có giọng đọc English');
});

test('preview and offline players never offer automatic translation', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  await page.route('**/api/tours/mine/' + id + '/preview*', (r) => json(r, { tour: view('vi') }));
  await page.goto('/studio/tours/' + id + '/preview?mode=remote&stop=' + secondId);
  await page.getByRole('button', { name: 'Đổi ngôn ngữ' }).click();
  await expect(page.getByRole('listbox', { name: 'Ngôn ngữ nghe' })).toBeVisible();
  await expect(page.locator('.langmenu__label')).toHaveCount(0);
});

test('studio: automatic languages can be turned on, and the auto switch is saved', async ({ page }) => {
  await fixtures(page);
  await signIn(page);
  const config = { ...structuredClone(languages), autoTranslate: true, autoLanguages: [{ languageCode: 'de', ready: true, translated: 2, total: 2 }] };
  const puts = [];
  await page.route('**/api/tours/mine/*/languages', (r) => json(r, { config }));
  await page.route('**/api/tours/mine/*/languages/auto-translate', (r) => {
    puts.push(r.request().postDataJSON());
    return json(r, { autoTranslate: false });
  });
  await page.goto('/studio/tours/' + id + '/languages');
  const list = page.getByRole('list', { name: 'Ngôn ngữ khách đã yêu cầu dịch tự động' });
  await expect(list).toContainText('Deutsch');
  await list.getByRole('button', { name: 'Bật ngôn ngữ này' }).click();
  await expect(list).toContainText('Sẽ bật khi lưu');
  await expect(page.getByRole('button', { name: /Deutsch/ }).first()).toHaveAttribute('aria-pressed', 'true');
  const box = page.getByRole('checkbox', { name: /Cho khách yêu cầu dịch tự động/ });
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  expect(puts).toEqual([{ enabled: false }]);
});
