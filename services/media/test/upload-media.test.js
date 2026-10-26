// =========================================================
// Unit test tải ảnh/audio (media service) — không cần mạng/DB.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MediaFile, contentTypesFor } from '../src/domain/value-objects/media-file.js';
import { UploadMedia } from '../src/application/use-cases/upload-media.js';
import { LocalDiskStorage } from '../src/infrastructure/storage/local-disk-storage.js';
import { SupabaseStorage } from '../src/infrastructure/storage/supabase-storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(8)]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0]);

test('MediaFile: nhận ảnh/audio đúng định dạng, chuẩn hoá Content-Type', () => {
  const img = new MediaFile({ kind: 'image', contentType: 'image/PNG; charset=binary', data: PNG });
  assert.equal(img.contentType, 'image/png');
  assert.equal(img.ext, 'png');
  assert.equal(new MediaFile({ kind: 'audio', contentType: 'audio/mpeg', data: MP3 }).ext, 'mp3');
  assert.equal(new MediaFile({ kind: 'audio', contentType: 'audio/x-m4a', data: M4A }).ext, 'm4a');
  assert.equal(new MediaFile({ kind: 'audio', contentType: 'audio/webm', data: WEBM }).ext, 'webm');
});

test('MediaFile: sai loại / sai nội dung → 415', () => {
  assert.throws(() => new MediaFile({ kind: 'image', contentType: 'application/pdf', data: PNG }), (e) => e.status === 415);
  assert.throws(() => new MediaFile({ kind: 'image', contentType: 'audio/mpeg', data: MP3 }), (e) => e.status === 415);
  // Khai báo PNG nhưng nội dung là JPEG (đổi đuôi) → chặn.
  assert.throws(() => new MediaFile({ kind: 'image', contentType: 'image/png', data: JPG }), (e) => e.code === 'unsupported_media');
  assert.throws(() => new MediaFile({ kind: 'video', contentType: 'image/png', data: PNG }), (e) => e.status === 415);
});

test('MediaFile: rỗng hoặc quá lớn → 413', () => {
  assert.throws(() => new MediaFile({ kind: 'image', contentType: 'image/png', data: Buffer.alloc(0) }), (e) => e.status === 413);
  const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
  assert.throws(() => new MediaFile({ kind: 'image', contentType: 'image/png', data: big }), /tối đa 8 MB/);
});

test('contentTypesFor: liệt kê định dạng theo loại', () => {
  assert.ok(contentTypesFor('image').includes('image/webp'));
  assert.ok(contentTypesFor('audio').includes('audio/mpeg'));
  assert.ok(!contentTypesFor('audio').includes('image/png'));
});

test('UploadMedia: khoá theo loại/năm/tháng/người tải/uuid, trả URL công khai', async () => {
  const calls = [];
  const storage = { async put(p) { calls.push(p); return { url: `https://cdn/${p.key}` }; } };
  const uc = new UploadMedia({ storage, now: () => new Date('2026-10-26T10:00:00Z'), uuid: () => 'u-1' });
  const r = await uc.execute({ uploaderId: 'user-9', kind: 'image', contentType: 'image/png', data: PNG });
  assert.equal(r.key, 'images/2026/10/user-9/u-1.png');
  assert.equal(r.url, 'https://cdn/images/2026/10/user-9/u-1.png');
  assert.equal(r.size, PNG.length);
  assert.equal(calls[0].contentType, 'image/png');
});

test('UploadMedia: lưu trữ lỗi → 503 (cho thử lại)', async () => {
  const uc = new UploadMedia({ storage: { async put() { throw new Error('ECONNRESET'); } } });
  await assert.rejects(
    () => uc.execute({ uploaderId: 'u', kind: 'audio', contentType: 'audio/mpeg', data: MP3 }),
    (e) => e.status === 503 && e.code === 'storage_unavailable',
  );
});

test('LocalDiskStorage: ghi file và trả URL theo publicBaseUrl', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gs-media-'));
  try {
    const s = new LocalDiskStorage({ dir, publicBaseUrl: 'http://localhost:8080/api/media/files/' });
    const { url } = await s.put({ key: 'images/2026/10/u/a.png', data: PNG, contentType: 'image/png' });
    assert.equal(url, 'http://localhost:8080/api/media/files/images/2026/10/u/a.png');
    assert.deepEqual(await readFile(path.join(dir, 'images/2026/10/u/a.png')), PNG);
    await assert.rejects(() => s.put({ key: '../evil.png', data: PNG }), /không hợp lệ/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('SupabaseStorage: PUT đúng endpoint + header, trả URL public', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '' };
  };
  const s = new SupabaseStorage({ url: 'https://x.supabase.co/', serviceKey: 'svc', bucket: 'geosound-media', fetchImpl });
  const { url } = await s.put({ key: 'audios/2026/10/u/a.mp3', data: MP3, contentType: 'audio/mpeg' });
  assert.equal(calls[0].url, 'https://x.supabase.co/storage/v1/object/geosound-media/audios/2026/10/u/a.mp3');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer svc');
  assert.equal(calls[0].init.headers['Content-Type'], 'audio/mpeg');
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/geosound-media/audios/2026/10/u/a.mp3');
});

test('SupabaseStorage: lỗi HTTP → ném lỗi', async () => {
  const s = new SupabaseStorage({
    url: 'https://x.supabase.co', serviceKey: 'k', bucket: 'b',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'denied' }),
  });
  await assert.rejects(() => s.put({ key: 'a.png', data: PNG, contentType: 'image/png' }), /403/);
});
