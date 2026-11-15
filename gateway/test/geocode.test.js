// Unit test proxy tìm địa chỉ (gateway) — Nominatim giả, không gọi mạng.
//   node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder } from '../src/geocode.js';

function fakeFetch(rows) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => rows };
  };
  fn.calls = calls;
  return fn;
}

const ROWS = [{ name: 'Chùa Cầu', display_name: 'Chùa Cầu, Nguyễn Thị Minh Khai, Hội An', lat: '15.877', lon: '108.326' }];

test('search: map kết quả Nominatim, gửi User-Agent + accept-language=vi', async () => {
  const fetchImpl = fakeFetch(ROWS);
  const g = createGeocoder({ fetchImpl, userAgent: 'GeoSound-test', sleep: async () => {} });
  const r = await g.search('Chùa Cầu Hội An');
  assert.deepEqual(r, [{ name: 'Chùa Cầu', displayName: 'Chùa Cầu, Nguyễn Thị Minh Khai, Hội An', lat: 15.877, lng: 108.326 }]);
  assert.match(fetchImpl.calls[0].url, /accept-language=vi/);
  assert.match(fetchImpl.calls[0].url, /q=Ch%C3%B9a%20C%E1%BA%A7u%20H%E1%BB%99i%20An/);
  assert.equal(fetchImpl.calls[0].init.headers['User-Agent'], 'GeoSound-test');
});

test('search: cùng địa chỉ (khác hoa thường) → lấy từ cache, không gọi lại', async () => {
  const fetchImpl = fakeFetch(ROWS);
  const g = createGeocoder({ fetchImpl, sleep: async () => {} });
  await g.search('Hội An');
  await g.search('hội an');
  assert.equal(fetchImpl.calls.length, 1);
});

test('search: hai địa chỉ liền nhau → lần sau chờ đủ 1 giây (điều khoản Nominatim)', async () => {
  let t = 0;
  const waits = [];
  const g = createGeocoder({
    fetchImpl: fakeFetch(ROWS),
    now: () => t,
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
  });
  await g.search('Hội An');
  t += 200;
  await g.search('Đà Nẵng');
  assert.deepEqual(waits, [800]);
});

test('handler: chuỗi ngắn → rỗng; lỗi Nominatim → 503', async () => {
  const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => ((r.code = c), r);
    r.json = (b) => ((r.body = b), r);
    return r;
  };
  const ok = createGeocoder({ fetchImpl: fakeFetch(ROWS), sleep: async () => {} });
  const short = res();
  await ok.handler({ query: { q: 'ab' } }, short);
  assert.deepEqual(short.body, { results: [] });

  const bad = createGeocoder({ fetchImpl: async () => ({ ok: false, status: 429 }), sleep: async () => {} });
  const r = res();
  await bad.handler({ query: { q: 'Hội An' } }, r);
  assert.equal(r.code, 503);
});
