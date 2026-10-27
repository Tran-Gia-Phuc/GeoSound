import { expect } from '@playwright/test';
export const id = '11111111-1111-4111-8111-111111111111';
export const secondId = '22222222-2222-4222-8222-222222222222';
export const userId = '33333333-3333-4333-8333-333333333333';
export const places = [
  {
    id: secondId,
    placeId: secondId,
    name: 'Điểm đầu tiên',
    lat: 15.877,
    lng: 108.327,
    sequence: 0,
    text: 'Nội dung điểm đầu tiên vẫn đọc được khi âm thanh lỗi.',
    audioUrl: null,
    audioSource: 'tts',
    images: [],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    placeId: '44444444-4444-4444-8444-444444444444',
    name: 'Điểm thứ hai',
    lat: 15.878,
    lng: 108.328,
    sequence: 1,
    text: 'Nội dung điểm thứ hai.',
    audioUrl: null,
    audioSource: 'tts',
    images: [],
  },
];
export const tour = {
  id,
  title: 'Chuyện phố cổ',
  description: 'Một hành trình kiểm tra giao diện.',
  city: 'Hội An',
  originalLanguage: 'vi',
  selectedLanguage: 'vi',
  availableLanguages: ['vi', 'en'],
  pendingLanguages: [],
  type: 'walking',
  duration: 40,
  averageRating: 0,
  ratingCount: 0,
  placeCount: 2,
  voiceLabel: 'tts',
  places,
  route: { path: places.map((p) => ({ lat: p.lat, lng: p.lng })), triggers: [], navAudios: [] },
  reviews: [],
  status: 'draft',
  authorId: userId,
  createdAt: '2026-10-26T03:00:00.000Z',
  updatedAt: '2026-10-27T03:00:00.000Z',
};
export const itinerary = {
  ...tour,
  name: 'Hành trình của tôi',
  isItinerary: true,
  ownerId: userId,
  shareToken: null,
  distanceMeters: 180,
  walkingMinutes: 3,
  legMeters: [180],
};
export const library = [
  {
    id,
    name: itinerary.name,
    placeCount: 2,
    distanceMeters: 180,
    walkingMinutes: 3,
    previewPlaces: places.map((p) => p.name),
    updatedAt: tour.updatedAt,
    shareToken: null,
  },
];
export const languages = {
  tourId: id,
  sourceLanguage: 'vi',
  voice: { gender: 'female', region: null },
  languages: [
    { languageCode: 'vi', isSource: true, ready: true, translated: 2, total: 2 },
    { languageCode: 'en', isSource: false, ready: true, translated: 2, total: 2 },
  ],
  places: places.map((p) => ({
    placeId: p.id,
    name: p.name,
    translations: [
      {
        placeId: p.id,
        languageCode: 'vi',
        text: p.text,
        textSource: 'source',
        ttsUrl: null,
        ttsPrerendered: false,
      },
      {
        placeId: p.id,
        languageCode: 'en',
        text: 'Translated stop content.',
        textSource: 'edited',
        ttsUrl: 'tts://en/female/test.mp3',
        ttsPrerendered: false,
      },
    ],
  })),
};
export const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
export async function signIn(page, role = 'contributor', identity = userId) {
  await page.addInitScript(
    ({ role, identity }) =>
      localStorage.setItem(
        'geosound:auth',
        JSON.stringify({
          user: { id: identity, fullName: 'Test contributor', email: 'test@example.test', role },
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
        }),
      ),
    { role, identity },
  );
}
export async function fixtures(page) {
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()),
      method = route.request().method(),
      path = u.pathname;
    if (path === '/api/tours') return json(route, { tours: [tour], total: 1, page: 1, limit: 12 });
    if (path === '/api/places') return json(route, { items: [], total: 0, page: 1, pageSize: 12 });
    if (path === '/api/tours/' + id)
      return json(route, {
        tour: { ...tour, selectedLanguage: u.searchParams.get('lang') || 'vi' },
      });
    if (path === '/api/tours/mine')
      return json(route, {
        tours: [tour, { ...tour, id: secondId, title: 'Tour đang công khai', status: 'public' }],
      });
    if (path === '/api/itineraries' && method === 'GET')
      return json(route, { itineraries: library });
    if (path === '/api/itineraries/' + id && method === 'GET') return json(route, { itinerary });
    if (path === '/api/tours/mine/' + id) return json(route, { tour });
    if (path.endsWith('/readiness'))
      return json(route, {
        ready: true,
        canPublish: true,
        placeCount: 2,
        checks: [
          { key: 'title', label: 'Tên tour', required: true, ok: true },
          { key: 'language', label: 'Ngôn ngữ gốc', required: true, ok: true },
          { key: 'places', label: 'Điểm dừng', required: true, ok: true },
          { key: 'placeDescriptions', label: 'Mô tả điểm', required: true, ok: true },
        ],
      });
    if (path.endsWith('/languages')) return json(route, { config: languages });
    if (path.endsWith('/preview')) return json(route, { tour });
    return json(route, { error: 'Unexpected fixture request: ' + method + ' ' + path }, 404);
  });
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
}
export async function noOverflow(page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
}
export async function liveRead(page, path, assertion) {
  const response = await page.request.get('/api/tours?limit=1');
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.tours.length).toBeGreaterThan(0);
  await page.goto(path || '/tour/' + data.tours[0].id);
  await assertion(data.tours[0]);
}
