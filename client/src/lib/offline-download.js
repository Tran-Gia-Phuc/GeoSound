// =========================================================
// UC03 offline download (#103, #104, #161) — transfers of tour packages.
//   fetchTourPackage(tourId, lang) -> GET /api/tours/:id/package?lang= (public, no account)
//   restricted tour (UC14, decision L9) -> GET /api/tours/:id/restricted/package?lang= (signed in,
//   unlocked tester or owner); the package keeps `restricted: true` and sends no UC17 beacon.
//   startDownload / resumeDownload / pauseDownload / cancelDownload / retry (= resume)
// One transfer per package (tour + language), up to 3 files at a time, each with the transfer's
// AbortController. Per-file state is persisted after every file, so a pause, a reload or a lost
// connection resumes with the remaining files (a file cut in the middle is downloaded again).
// A package is "ready" only when every file of its manifest is stored. After ready the UC17
// 'download' beacon is sent once per package (flag stored with the package).
// Storage: navigator.storage.estimate() before, QuotaExceededError during -> StorageFullError
// (the package stays paused, never ready; other packages are untouched).
// The module is a singleton so a download keeps running while the user moves around the app.
// =========================================================
import { api, fetchAsset } from './api.js';
import { recordTourActivity } from './tour-stats.js';
import {
  getPackage,
  updatePackage,
  savePackage,
  storeAsset,
  deletePackage,
  packageKey,
  isQuotaError,
} from './offline-store.js';

const CONCURRENCY = 3;

export class StorageFullError extends Error {
  /** @param {{ required?: number|null, available?: number|null }} info */
  constructor({ required = null, available = null } = {}) {
    super('Không đủ dung lượng trên thiết bị để tải tour');
    this.name = 'StorageFullError';
    this.required = required;
    this.available = available;
  }
}

export class NoNetworkError extends Error {
  constructor() {
    super('Cần kết nối mạng (Wi-Fi hoặc dữ liệu di động) để tải tour');
    this.name = 'NoNetworkError';
    this.offline = true;
  }
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// ---------- API ----------

/**
 * -> { tourId, language, revision, detail, assets: [{ url, kind, placeId? }] }
 * `restricted: true` reads the package of an unlocked restricted tour (needs the account).
 */
export function fetchTourPackage(tourId, lang, { restricted = false, ...opts } = {}) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const path = restricted ? 'restricted/package' : 'package';
  return api.get(`/api/tours/${encodeURIComponent(tourId)}/${path}${q}`, restricted ? { ...opts, auth: true } : opts);
}

/** Browser quota: { quota, usage, available } or null when the browser does not tell. */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || !Number.isFinite(e.quota)) return null;
    const usage = Number.isFinite(e.usage) ? e.usage : 0;
    return { quota: e.quota, usage, available: Math.max(0, e.quota - usage) };
  } catch {
    return null;
  }
}

/** Sum of Content-Length of the files (HEAD). Unknown sizes are counted, never guessed. */
export async function probeSizes(assets, signal) {
  let bytes = 0;
  let unknown = 0;
  const queue = [...assets];
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      try {
        const res = await fetchAsset(a.url, { method: 'HEAD', signal });
        const len = Number(res.headers.get('content-length'));
        if (res.ok && Number.isFinite(len) && len > 0) bytes += len;
        else unknown += 1;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        unknown += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { bytes, unknown };
}

// ---------- live state + events ----------

const active = new Map(); // key -> { controller, stop: null|'pause'|'cancel', inflight: Map, authenticated }
const errors = new Map(); // key -> last transfer error (StorageFullError, NoNetworkError, Error)
const listeners = new Set();
let progressTimer = null;

function emit(type, key) {
  for (const fn of listeners) {
    try {
      fn({ type, key });
    } catch {
      /* listener errors never stop a download */
    }
  }
}

function emitProgress(key) {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    emit('progress', key);
  }, 150);
}

/** @param {(e: { type: 'change'|'progress', key: string }) => void} fn */
export function subscribeDownloads(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isDownloading = (key) => active.has(key);
export const downloadError = (key) => errors.get(key) ?? null;
/** Bytes of the files being received right now (not stored yet). */
export const inflightBytes = (key) => {
  const a = active.get(key);
  if (!a) return 0;
  let s = 0;
  for (const v of a.inflight.values()) s += v;
  return s;
};

/** A package saved as "downloading" without a live transfer was interrupted (reload, crash). */
export function effectiveStatus(pkg) {
  if (!pkg) return null;
  if (pkg.status === 'downloading' && !active.has(pkg.key)) return { status: 'paused', pauseReason: 'interrupted' };
  return { status: pkg.status, pauseReason: pkg.pauseReason ?? null };
}

// ---------- transfers ----------

/**
 * Starts (or refreshes, e.g. "Có bản mới") the package of one language.
 * Throws NoNetworkError, StorageFullError, ApiError (manifest).
 */
export async function startDownload(tourId, language, { authenticated = false, restricted = false } = {}) {
  const key = packageKey(tourId, language);
  if (active.has(key)) return;
  errors.delete(key);
  if (!isOnline()) throw rememberError(key, new NoNetworkError());
  let manifest;
  try {
    manifest = await fetchTourPackage(tourId, language, { restricted });
  } catch (e) {
    if (e?.offline) throw rememberError(key, new NoNetworkError());
    throw rememberError(key, e);
  }
  const prev = await getPackage(key);
  const detailBytes = new Blob([JSON.stringify(manifest.detail)]).size;
  const now = new Date().toISOString();
  await savePackage({
    key,
    tourId,
    language: manifest.language || language,
    title: manifest.detail?.title || prev?.title || '',
    restricted: !!(restricted || manifest.restricted),
    revision: manifest.revision ?? null,
    detail: manifest.detail,
    detailBytes,
    assets: manifest.assets.map((a) => ({ url: a.url, kind: a.kind, placeId: a.placeId ?? null })),
    status: 'paused',
    pauseReason: 'starting',
    estimate: null,
    createdAt: prev?.createdAt ?? now,
    readyAt: null,
    downloadReported: prev?.downloadReported ?? false,
  });
  emit('change', key);
  return run(key, { authenticated, checkSpace: true });
}

/** Continues a paused / interrupted / failed transfer with the files still missing. */
export async function resumeDownload(key, { authenticated = false } = {}) {
  if (active.has(key)) return;
  errors.delete(key);
  if (!isOnline()) throw rememberError(key, new NoNetworkError());
  return run(key, { authenticated, checkSpace: true });
}

export function pauseDownload(key) {
  const a = active.get(key);
  if (!a) return;
  a.stop = 'pause';
  a.controller.abort();
}

/** Stops the transfer and removes the unfinished package (files shared with other languages stay). */
export async function cancelDownload(key) {
  const a = active.get(key);
  if (a) {
    a.stop = 'cancel';
    a.controller.abort();
    await a.done;
    return;
  }
  errors.delete(key);
  await deletePackage(key);
  emit('change', key);
}

function rememberError(key, e) {
  errors.set(key, e);
  emit('change', key);
  return e;
}

async function setPaused(key, pauseReason) {
  await updatePackage(key, (p) => ({ ...p, status: 'paused', pauseReason }));
}

async function run(key, { authenticated, checkSpace }) {
  const controller = new AbortController();
  const ctx = { controller, stop: null, inflight: new Map(), authenticated, done: null };
  active.set(key, ctx);
  let resolveDone;
  ctx.done = new Promise((r) => (resolveDone = r));
  try {
    return await transfer(key, ctx, checkSpace);
  } finally {
    active.delete(key);
    resolveDone();
    emit('change', key);
  }
}

async function transfer(key, ctx, checkSpace) {
  const { signal } = ctx.controller;
  let pkg = await getPackage(key);
  if (!pkg) return;
  const pending = pkg.assets.filter((a) => a.state !== 'done');

  // #161 — space check before writing: real Content-Length sums against the browser quota.
  if (checkSpace && pending.length) {
    let estimate;
    try {
      estimate = await probeSizes(pending, signal);
    } catch {
      estimate = null; // aborted while probing
    }
    if (signal.aborted) return finishStopped(key, ctx);
    const space = await storageEstimate();
    pkg = await updatePackage(key, (p) => ({ ...p, estimate }));
    if (estimate && space && estimate.bytes > space.available) {
      await setPaused(key, 'quota');
      throw rememberError(key, new StorageFullError({ required: estimate.bytes, available: space.available }));
    }
  }

  await updatePackage(key, (p) => ({ ...p, status: 'downloading', pauseReason: null }));
  emit('change', key);

  const queue = [...pending];
  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal && !signal.aborted) {
      const asset = queue.shift();
      try {
        await downloadOne(key, asset, ctx);
        emit('change', key);
      } catch (e) {
        if (signal.aborted || e?.name === 'AbortError') return;
        if (isQuotaError(e)) {
          const space = await storageEstimate();
          fatal = new StorageFullError({ required: null, available: space?.available ?? null });
          ctx.controller.abort();
          return;
        }
        if (e?.offline || !isOnline()) {
          fatal = new NoNetworkError();
          ctx.controller.abort();
          return;
        }
        await updatePackage(key, (p) => ({
          ...p,
          assets: p.assets.map((a) => (a.url === asset.url ? { ...a, state: 'error', error: e?.message || 'Lỗi tải tệp' } : a)),
        }));
        emit('change', key);
      } finally {
        ctx.inflight.delete(asset.url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  if (fatal) {
    await setPaused(key, fatal instanceof StorageFullError ? 'quota' : 'offline');
    throw rememberError(key, fatal);
  }
  if (signal.aborted) return finishStopped(key, ctx);

  pkg = await getPackage(key);
  if (!pkg) return;
  const complete = pkg.assets.every((a) => a.state === 'done');
  if (!complete) {
    await setPaused(key, 'error');
    throw rememberError(key, new Error('Một số tệp chưa tải được. Hãy thử lại.'));
  }
  const report = !pkg.downloadReported;
  await updatePackage(key, (p) => ({
    ...p,
    status: 'ready',
    pauseReason: null,
    readyAt: new Date().toISOString(),
    downloadReported: true,
  }));
  requestPersistence();
  // UC17: one 'download' per completed package (the server also dedups per actor and day).
  if (report && !pkg.restricted) recordTourActivity(pkg.tourId, 'download', { language: pkg.language, authenticated: ctx.authenticated });
}

async function finishStopped(key, ctx) {
  if (ctx.stop === 'cancel') {
    await deletePackage(key);
    errors.delete(key);
    return;
  }
  await setPaused(key, 'user');
}

async function downloadOne(key, asset, ctx) {
  const { signal } = ctx.controller;
  const res = await fetchAsset(asset.url, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? 'Tệp không còn trên máy chủ' : `Lỗi máy chủ (${res.status})`);
  let blob;
  const type = res.headers.get('content-type') || '';
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      ctx.inflight.set(asset.url, received);
      emitProgress(key);
    }
    blob = new Blob(chunks, { type });
  } else {
    blob = await res.blob();
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await storeAsset(key, asset, blob);
}

/** #161: ask the browser to keep offline data (not evicted under storage pressure). */
function requestPersistence() {
  try {
    const s = navigator.storage;
    if (!s?.persist) return;
    Promise.resolve(s.persisted?.())
      .then((already) => (already ? null : s.persist()))
      .catch(() => {});
  } catch {
    /* optional browser feature */
  }
}
