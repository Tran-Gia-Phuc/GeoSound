// =========================================================
// Storage selection (deployment plan task 0.7, issue #353): MEDIA_STORAGE picks Supabase Storage or
// the local disk, and a production setting never falls back to the pod's disk. No network, no disk.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectStorage } from '../src/infrastructure/storage/select-storage.js';
import { LocalDiskStorage } from '../src/infrastructure/storage/local-disk-storage.js';
import { SupabaseStorage } from '../src/infrastructure/storage/supabase-storage.js';

const SUPABASE = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };

function recordingLogger() {
  const warnings = [];
  return { warnings, logger: { warn: (m) => warnings.push(m) } };
}

test('MEDIA_STORAGE=supabase with the keys uses Supabase Storage and no local dir', () => {
  const { storage, localDir } = selectStorage({ ...SUPABASE, MEDIA_STORAGE: 'supabase', SUPABASE_STORAGE_BUCKET: 'b1' });
  assert.ok(storage instanceof SupabaseStorage);
  assert.equal(storage.bucket, 'b1');
  assert.equal(localDir, null);
});

test('MEDIA_STORAGE=supabase without the keys throws at start', () => {
  assert.throws(() => selectStorage({ MEDIA_STORAGE: 'supabase' }), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  assert.throws(
    () => selectStorage({ MEDIA_STORAGE: 'supabase', SUPABASE_URL: SUPABASE.SUPABASE_URL }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test('MEDIA_STORAGE=local forces the local disk even when Supabase is configured', () => {
  const { storage, localDir } = selectStorage({ ...SUPABASE, MEDIA_STORAGE: 'local', MEDIA_DIR: '/tmp/m' });
  assert.ok(storage instanceof LocalDiskStorage);
  assert.equal(localDir, '/tmp/m');
});

test('MEDIA_STORAGE unset keeps the automatic choice (Supabase when configured, else local disk)', () => {
  assert.ok(selectStorage({ ...SUPABASE }).storage instanceof SupabaseStorage);
  const local = selectStorage({ MEDIA_STORAGE: '' });
  assert.ok(local.storage instanceof LocalDiskStorage);
  assert.equal(local.localDir, '/data/media');
});

test('MEDIA_STORAGE is case-insensitive and rejects unknown values', () => {
  assert.ok(selectStorage({ ...SUPABASE, MEDIA_STORAGE: ' Supabase ' }).storage instanceof SupabaseStorage);
  assert.throws(() => selectStorage({ MEDIA_STORAGE: 's3' }), /must be "supabase" or "local"/);
});

test('local disk with NODE_ENV=production logs a warning; dev stays quiet', () => {
  const prod = recordingLogger();
  selectStorage({ NODE_ENV: 'production' }, { logger: prod.logger });
  assert.equal(prod.warnings.length, 1);
  assert.match(prod.warnings[0], /MEDIA_STORAGE=supabase/);

  const dev = recordingLogger();
  selectStorage({ NODE_ENV: 'development', MEDIA_STORAGE: 'local' }, { logger: dev.logger });
  selectStorage({ ...SUPABASE, NODE_ENV: 'production' }, { logger: dev.logger });
  assert.equal(dev.warnings.length, 0);
});
