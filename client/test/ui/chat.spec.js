import { expect, test } from '@playwright/test';
import { fixtures, id, json, noOverflow } from './fixtures.js';

// Chatbot UI (#188): every chat route is mocked; the backend streams Server-Sent Events.
const SESSION = '55555555-5555-4555-8555-555555555555';
const PLACE_ID = '66666666-6666-4666-8666-666666666666';

const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const answerEvents = [
  ['meta', { session_id: SESSION, lang: 'vi' }],
  ['token', { text: 'Bạn có thể thử ' }],
  ['token', { text: 'Chuyện phố cổ ' }],
  ['token', { text: `[tour:${id}] ` }],
  ['token', { text: 'và ghé Chùa Cầu ' }],
  ['token', { text: `[place:${PLACE_ID}].` }],
  [
    'citations',
    {
      items: [
        { kind: 'tour', id, title: 'Chuyện phố cổ' },
        { kind: 'place', id: PLACE_ID, title: 'Chùa Cầu' },
      ],
    },
  ],
  ['done', { finish_reason: 'stop', llm_calls: 1 }],
];
const streamOk = (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(answerEvents) });
const isChat = (u) => u.pathname === '/api/chat';
const isHistory = (u) => u.pathname === '/api/chat/history';
const fab = (page) => page.getByRole('button', { name: 'Mở trợ lý GeoSound' });

/** Chatbot on: history knows `history` for SESSION, every other id is "unknown session". */
async function chatOn(page, { history = null, chat } = {}) {
  const calls = { chat: [], history: [] };
  await page.route(isHistory, (route) => {
    const sid = new URL(route.request().url()).searchParams.get('session_id');
    calls.history.push(sid);
    if (history && sid === SESSION) return json(route, { session_id: SESSION, messages: history });
    return json(route, { detail: 'unknown session' }, 404);
  });
  await page.route(isChat, async (route) => {
    calls.chat.push(route.request().postDataJSON());
    return chat ? chat(route, calls.chat.length) : streamOk(route);
  });
  return calls;
}

async function openPanel(page) {
  await fab(page).click();
  const panel = page.getByRole('dialog', { name: 'Trợ lý GeoSound' });
  await expect(panel).toBeVisible();
  // Wait for the slide-up animation before measuring.
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return panel;
}

test.beforeEach(async ({ page }) => {
  await fixtures(page);
});

test('chatbot off (404 probe) hides the button; /chat says it is off', async ({ page }) => {
  const probe = page.waitForResponse((r) => r.url().includes('/api/chat/history'));
  await page.goto('/');
  expect((await probe).status()).toBe(404);
  await page.waitForTimeout(200);
  await expect(fab(page)).toHaveCount(0);
  await page.goto('/chat');
  await expect(page.getByText('Chatbot đang tắt')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' })).toHaveCount(0);
});

test('streams an answer, turns markers into links and lists the sources', async ({ page }) => {
  const calls = await chatOn(page);
  await page.goto('/');
  const panel = await openPanel(page);
  await expect(panel.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' })).toBeFocused();
  await expect(panel.getByRole('group', { name: 'Gợi ý câu hỏi' })).toBeVisible();
  await panel.getByRole('button', { name: 'Gợi ý tour đi bộ ở Hội An' }).click();

  const answer = panel.getByTestId('chat-answer');
  await expect(answer).toContainText('Bạn có thể thử Chuyện phố cổ');
  await expect(answer).not.toContainText('[tour:');
  await expect(answer).not.toContainText('[place:');
  await expect(answer.getByRole('link', { name: 'Nguồn 1: Tour Chuyện phố cổ' })).toHaveAttribute('href', `/tour/${id}`);
  // Place citations carry no tour id: plain text, not a link.
  await expect(answer.getByLabel('Nguồn 2: Địa điểm Chùa Cầu')).toBeVisible();
  await expect(answer.getByRole('link', { name: /Chùa Cầu/ })).toHaveCount(0);
  await expect(answer.getByText('Nguồn', { exact: true })).toBeVisible();
  await expect(answer.getByRole('listitem')).toHaveCount(2);
  await expect(answer.getByRole('link', { name: 'Chuyện phố cổ', exact: true })).toHaveAttribute('href', `/tour/${id}`);

  expect(calls.chat[0]).toEqual({ message: 'Gợi ý tour đi bộ ở Hội An' });
  expect(await page.evaluate(() => localStorage.getItem('geosound:chat-session'))).toBe(SESSION);

  // Second turn keeps the session from `meta`; Enter sends.
  const box = panel.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' });
  await box.fill('Còn tour nào khác?');
  await box.press('Enter');
  await expect(panel.getByTestId('chat-answer')).toHaveCount(2);
  expect(calls.chat[1]).toEqual({ message: 'Còn tour nào khác?', session_id: SESSION });

  // A source link opens the tour page.
  await answer.first().getByRole('link', { name: 'Nguồn 1: Tour Chuyện phố cổ' }).click();
  await expect(page).toHaveURL(new RegExp(`/tour/${id}$`));
});

test('"near me" question sends the position; a place citation with tour_id links to its tour', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 15.877, longitude: 108.326 });
  const calls = await chatOn(page, {
    chat: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          ['meta', { session_id: SESSION, lang: 'vi' }],
          ['token', { text: `Gần bạn có Chùa Cầu [place:${PLACE_ID}].` }],
          ['citations', { items: [{ kind: 'place', id: PLACE_ID, title: 'Chùa Cầu', tour_id: id }] }],
          ['done', { finish_reason: 'stop', llm_calls: 1 }],
        ]),
      }),
  });
  await page.goto('/');
  const panel = await openPanel(page);
  const box = panel.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' });
  await box.fill('Có gì hay gần tôi?');
  await box.press('Enter');

  const answer = panel.getByTestId('chat-answer');
  await expect(answer.getByRole('link', { name: 'Nguồn 1: Địa điểm Chùa Cầu' })).toHaveAttribute('href', `/tour/${id}`);
  expect(calls.chat[0]).toEqual({ message: 'Có gì hay gần tôi?', location: { lat: 15.877, lng: 108.326 } });
});

test('no location permission and a normal question: no position is asked or sent', async ({ page }) => {
  const calls = await chatOn(page);
  await page.goto('/');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Gợi ý tour đi bộ ở Hội An' }).click();
  await expect(panel.getByTestId('chat-answer')).toContainText('Chuyện phố cổ');
  expect(calls.chat[0].location).toBeUndefined();
});

test('reloads the stored conversation; "Cuộc trò chuyện mới" forgets it', async ({ page }) => {
  await page.addInitScript((sid) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('geosound:chat-session', sid);
      sessionStorage.setItem('seeded', '1');
    }
  }, SESSION);
  const calls = await chatOn(page, {
    history: [
      { role: 'user', content: 'Tour ở Hội An?', at: '2026-11-08T03:00:00Z' },
      {
        role: 'assistant',
        content: `Có Chuyện phố cổ [tour:${id}].`,
        at: '2026-11-08T03:00:05Z',
        citations: [{ kind: 'tour', id, title: 'Chuyện phố cổ' }],
      },
    ],
  });
  await page.goto('/chat');
  await expect(page.getByText('Tour ở Hội An?')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nguồn 1: Tour Chuyện phố cổ' })).toHaveAttribute('href', `/tour/${id}`);
  expect(calls.history).toContain(SESSION);

  await page.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click();
  await expect(page.getByText('Tour ở Hội An?')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Gợi ý câu hỏi' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('geosound:chat-session'))).toBeNull();
  await page.getByRole('button', { name: 'Quán ăn gần Phố cổ' }).click();
  await expect(page.getByTestId('chat-answer')).toBeVisible();
  expect(calls.chat[0]).toEqual({ message: 'Quán ăn gần Phố cổ' });
});

test('expired session: history 404 "unknown session" starts fresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('geosound:chat-session', '77777777-7777-4777-8777-777777777777'));
  await chatOn(page);
  await page.goto('/chat');
  await expect(page.getByRole('group', { name: 'Gợi ý câu hỏi' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('geosound:chat-session'))).toBeNull();
});

test('history load failure shows "Thử lại"', async ({ page }) => {
  await page.addInitScript((sid) => localStorage.setItem('geosound:chat-session', sid), SESSION);
  let fail = true;
  await page.route(isHistory, (route) =>
    fail ? route.abort('internetdisconnected') : json(route, { session_id: SESSION, messages: [] }),
  );
  await page.goto('/chat');
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối, vui lòng thử lại');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('group', { name: 'Gợi ý câu hỏi' })).toBeVisible();
});

test('typing indicator while waiting, stop keeps the question', async ({ page }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  await chatOn(page, {
    chat: async (route) => {
      await gate;
      await streamOk(route).catch(() => {});
    },
  });
  await page.goto('/chat');
  await page.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' }).fill('Tour đêm?');
  await page.getByRole('button', { name: 'Gửi' }).click();
  await expect(page.getByTestId('chat-typing')).toBeVisible();
  await page.getByRole('button', { name: 'Dừng' }).click();
  await expect(page.getByText('Đã dừng')).toBeVisible();
  await expect(page.getByTestId('chat-typing')).toHaveCount(0);
  await expect(page.getByText('Tour đêm?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible();
  release();
});

test('an `error` event mid-stream shows the error under the partial answer', async ({ page }) => {
  await chatOn(page, {
    chat: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          ['meta', { session_id: SESSION, lang: 'vi' }],
          ['token', { text: 'Đang tìm ' }],
          ['error', { code: 'internal', message: 'Chat is temporarily unavailable; retry later' }],
        ]),
      }),
  });
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Gợi ý tour đi bộ ở Hội An' }).click();
  await expect(page.getByTestId('chat-answer')).toContainText('Đang tìm');
  await expect(page.getByRole('alert')).toContainText('Trợ lý gặp lỗi khi trả lời, vui lòng thử lại.');
});

test('429 from the gateway shows the retry time; "Thử lại" resends', async ({ page }) => {
  const calls = await chatOn(page, {
    chat: (route, n) =>
      n === 1
        ? route.fulfill({
            status: 429,
            contentType: 'application/json',
            headers: { 'Retry-After': '30' },
            body: JSON.stringify({ error: 'Too many chat requests' }),
          })
        : streamOk(route),
  });
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Quán ăn gần Phố cổ' }).click();
  const alert = page.getByTestId('chat-error');
  await expect(alert).toContainText('Bạn đã hỏi quá nhiều trong thời gian ngắn, vui lòng thử lại sau 30 giây.');
  await expect(page.getByText('Chưa gửi được')).toBeVisible();
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByTestId('chat-answer')).toBeVisible();
  await expect(page.getByText('Chưa gửi được')).toHaveCount(0);
  expect(calls.chat).toHaveLength(2);
});

test('AI busy 429 and 503 messages', async ({ page }) => {
  await chatOn(page, {
    chat: (route, n) =>
      n === 1
        ? route.fulfill({
            status: 429,
            contentType: 'application/json',
            headers: { 'Retry-After': '5' },
            body: JSON.stringify({ detail: 'Chat is busy; retry later' }),
          })
        : json(route, { detail: 'Chat is temporarily unavailable; retry later' }, 503),
  });
  await page.goto('/chat');
  const box = page.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' });
  await box.fill('A');
  await box.press('Enter');
  await expect(page.getByTestId('chat-error')).toContainText('Trợ lý đang bận, vui lòng thử lại sau 5 giây.');
  await box.fill('B');
  await box.press('Enter');
  await expect(page.getByTestId('chat-error')).toContainText('Trợ lý tạm thời không phản hồi');
});

test('offline: network failure says "Không thể kết nối"', async ({ page }) => {
  await chatOn(page, { chat: (route) => route.abort('internetdisconnected') });
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Gợi ý tour đi bộ ở Hội An' }).click();
  await expect(page.getByTestId('chat-error')).toContainText('Không thể kết nối, vui lòng thử lại');
});

test('chatbot turned off between probe and send (POST 404) hides the button', async ({ page }) => {
  await chatOn(page, { chat: (route) => json(route, { error: 'Not found' }, 404) });
  await page.goto('/');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Quán ăn gần Phố cổ' }).click();
  await expect(panel.getByText('Chatbot đang tắt')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fab(page)).toHaveCount(0);
});

test('message counter and the 1000 character limit', async ({ page }) => {
  await chatOn(page);
  await page.goto('/chat');
  const box = page.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' });
  await expect(page.getByText('0/1000')).toBeVisible();
  await box.fill('x'.repeat(1200));
  await expect(page.getByText('1000/1000')).toBeVisible();
  expect((await box.inputValue()).length).toBe(1000);
  await box.fill('   ');
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeDisabled();
});

test('Esc closes the panel and focus goes back to the button; "Mở toàn màn hình" opens /chat', async ({ page }) => {
  await chatOn(page);
  await page.goto('/');
  await openPanel(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Trợ lý GeoSound' })).toHaveCount(0);
  await expect(fab(page)).toBeFocused();
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Mở toàn màn hình' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('heading', { name: 'Trợ lý GeoSound' })).toBeVisible();
  await expect(fab(page)).toHaveCount(0);
});

test('no chat button on login or the tour detail page', async ({ page }) => {
  await chatOn(page);
  await page.goto('/');
  await expect(fab(page)).toBeVisible();
  for (const path of ['/login', `/tour/${id}`]) {
    await page.goto(path);
    await page.waitForTimeout(300);
    await expect(fab(page)).toHaveCount(0);
  }
});

test('phone 390 px: button above the tab bar, bottom sheet, no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chatOn(page);
  await page.goto('/');
  await expect(fab(page)).toBeVisible();
  const tabbar = await page.locator('.tabbar').boundingBox();
  const fabBox = await fab(page).boundingBox();
  expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(tabbar.y);
  await noOverflow(page);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Gợi ý tour đi bộ ở Hội An' }).click();
  await expect(panel.getByTestId('chat-answer')).toBeVisible();
  const box = await panel.boundingBox();
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
  await noOverflow(page);
  await page.goto('/chat');
  await expect(page.getByRole('group', { name: 'Gợi ý câu hỏi' })).toBeVisible(); // mock forgets the session
  await noOverflow(page);
});

test('desktop: side panel on the right under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await chatOn(page);
  await page.goto('/');
  const panel = await openPanel(page);
  const box = await panel.boundingBox();
  expect(Math.round(box.width)).toBe(400);
  expect(Math.round(box.x + box.width)).toBe(1280);
  const nav = await page.locator('.topnav').boundingBox();
  expect(Math.round(box.y)).toBe(Math.round(nav.y + nav.height));
  await noOverflow(page);
});
