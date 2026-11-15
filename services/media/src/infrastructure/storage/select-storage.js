// Picks the MediaStorage adapter from the environment. Own module (not container.js) so tests
// import it without the HTTP routes, which load ../shared.
import { SupabaseStorage } from './supabase-storage.js';
import { LocalDiskStorage } from './local-disk-storage.js';

// Storage choice (deployment plan task 0.7, issue #353):
//   MEDIA_STORAGE=supabase -> Supabase Storage; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required
//                             (production: pods keep no file, any replica serves any upload).
//   MEDIA_STORAGE=local    -> local disk MEDIA_DIR (dev only: files live on one pod's disk).
//   unset                  -> Supabase when both keys are set, else local disk (local compose).
// A wrong setting throws at start instead of silently writing to the pod's disk.
export function selectStorage(env, { logger = console } = {}) {
  const mode = (env.MEDIA_STORAGE ?? '').trim().toLowerCase();
  if (mode && mode !== 'supabase' && mode !== 'local') {
    throw new Error(`MEDIA_STORAGE must be "supabase" or "local" (got "${env.MEDIA_STORAGE}")`);
  }
  const supabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (mode === 'supabase' && !supabaseConfigured) {
    throw new Error('MEDIA_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  if (mode === 'supabase' || (!mode && supabaseConfigured)) {
    return {
      storage: new SupabaseStorage({
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.SUPABASE_STORAGE_BUCKET || 'geosound-media',
      }),
      localDir: null,
    };
  }
  const dir = env.MEDIA_DIR || '/data/media';
  if (env.NODE_ENV === 'production') {
    logger.warn(
      `[media] uploads are stored on the local disk (${dir}): they are lost when the pod moves. `
        + 'Set MEDIA_STORAGE=supabase in production.',
    );
  }
  return {
    storage: new LocalDiskStorage({
      dir,
      publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL || 'http://localhost:8080/api/media/files',
    }),
    localDir: dir,
  };
}
