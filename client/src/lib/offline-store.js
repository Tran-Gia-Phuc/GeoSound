// =========================================================
// UC03 offline tours (#103, #104, #158, #159) — device storage in IndexedDB (no dependency).
// Database "geosound-offline" v1:
//   packages  key "<tourId>|<language>" -> { key, tourId, language, title, revision, detail,
//             detailBytes, assets: [{ url, kind, placeId?, state: pending|done|error, size?, error? }],
//             status: downloading|paused|ready, pauseReason, estimate, createdAt, updatedAt,
//             readyAt, downloadReported }
//   assets    key url -> { url, tourId, kind, type, size, blob, owners: [packageKey] }
// One file is stored once per device; `owners` counts the language packages that use it, so
// deleting one language frees only the files no other language of the tour needs (#159).
// Sizes are the real Blob sizes (never invented); detailBytes = size of the stored JSON.
// =========================================================

const DB_NAME = 'geosound-offline';
const DB_VERSION = 1;

export class OfflineStorageError extends Error {
  constructor(message = 'Không đọc được bộ nhớ trên thiết bị này', cause) {
    super(message);
    this.name = 'OfflineStorageError';
    this.cause = cause;
  }
}

/** Local data missing or broken (shown by the offline player). */
export class OfflineDataError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'OfflineDataError';
    this.status = status;
  }
}

export const packageKey = (tourId, language) => `${tourId}|${language}`;

export const isQuotaError = (e) =>
  e?.name === 'QuotaExceededError' || e?.code === 22 || e?.inner?.name === 'QuotaExceededError';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new OfflineStorageError(undefined, e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('packages')) {
        db.createObjectStore('packages', { keyPath: 'key' }).createIndex('tourId', 'tourId');
      }
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'url' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new OfflineStorageError(undefined, req.error));
    req.onblocked = () => reject(new OfflineStorageError('Bộ nhớ offline đang bị khoá bởi một thẻ khác'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * Runs `work(stores)` in one transaction and resolves with its result once the transaction
 * commits. Only IndexedDB requests may be awaited inside `work`. Errors (QuotaExceededError
 * included) reject with the original DOMException.
 */
async function withTx(names, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    let failed = null;
    try {
      tx = db.transaction(names, mode);
    } catch (e) {
      reject(e);
      return;
    }
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    tx.oncomplete = () => (failed ? reject(failed) : resolve(result));
    tx.onerror = () => {
      failed = failed || tx.error;
    };
    tx.onabort = () => reject(failed || tx.error || new OfflineStorageError('Ghi bộ nhớ bị huỷ'));
    Promise.resolve()
      .then(() => work(stores))
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        failed = e;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
      });
  });
}

// ---------- packages ----------

export const getPackage = (key) => withTx(['packages'], 'readonly', ({ packages }) => reqP(packages.get(key)));

export const listPackages = () => withTx(['packages'], 'readonly', ({ packages }) => reqP(packages.getAll()));

export const listTourPackages = (tourId) =>
  withTx(['packages'], 'readonly', ({ packages }) => reqP(packages.index('tourId').getAll(tourId)));

export const putPackage = (pkg) =>
  withTx(['packages'], 'readwrite', ({ packages }) => reqP(packages.put({ ...pkg, updatedAt: new Date().toISOString() })));

/** Read-modify-write of one package in a single transaction. `fn` returns the new record. */
export const updatePackage = (key, fn) =>
  withTx(['packages'], 'readwrite', async ({ packages }) => {
    const cur = await reqP(packages.get(key));
    if (!cur) return null;
    const next = { ...fn(cur), updatedAt: new Date().toISOString() };
    await reqP(packages.put(next));
    return next;
  });

/** Bytes a package uses on the device (its files, shared or not, plus its JSON). */
export const packageBytes = (pkg) =>
  (pkg?.detailBytes || 0) + (pkg?.assets || []).reduce((s, a) => s + (a.state === 'done' ? a.size || 0 : 0), 0);

/**
 * Saves a (new or refreshed) package record. Files the new manifest no longer lists lose this
 * package as owner; files already stored by another language are claimed (marked done, no
 * second download).
 */
export const savePackage = (pkg) =>
  withTx(['packages', 'assets'], 'readwrite', async ({ packages, assets }) => {
    const prev = await reqP(packages.get(pkg.key));
    const keep = new Set(pkg.assets.map((a) => a.url));
    for (const old of prev?.assets ?? []) {
      if (!keep.has(old.url)) await dropOwner(assets, old.url, pkg.key);
    }
    const list = [];
    for (const a of pkg.assets) {
      const stored = await reqP(assets.get(a.url));
      if (stored?.blob) {
        if (!stored.owners.includes(pkg.key)) {
          await reqP(assets.put({ ...stored, owners: [...stored.owners, pkg.key] }));
        }
        list.push({ ...a, state: 'done', size: stored.size, error: null });
      } else {
        list.push({ ...a, state: 'pending', size: null, error: null });
      }
    }
    const next = { ...pkg, assets: list, updatedAt: new Date().toISOString() };
    await reqP(packages.put(next));
    return next;
  });

async function dropOwner(assets, url, key) {
  const stored = await reqP(assets.get(url));
  if (!stored) return 0;
  const owners = stored.owners.filter((o) => o !== key);
  if (owners.length) {
    await reqP(assets.put({ ...stored, owners }));
    return 0;
  }
  await reqP(assets.delete(url));
  revokeObjectUrl(url);
  return stored.size || 0;
}

/** Stores one downloaded file and marks it done in the package (one transaction). */
export const storeAsset = (key, asset, blob) =>
  withTx(['packages', 'assets'], 'readwrite', async ({ packages, assets }) => {
    const pkg = await reqP(packages.get(key));
    if (!pkg) return null; // cancelled meanwhile
    const stored = await reqP(assets.get(asset.url));
    const owners = new Set(stored?.owners ?? []);
    owners.add(key);
    const size = stored?.blob ? stored.size : blob.size;
    if (!stored?.blob) {
      await reqP(
        assets.put({ url: asset.url, tourId: pkg.tourId, kind: asset.kind, type: blob.type, size, blob, owners: [...owners] }),
      );
    } else if (owners.size !== stored.owners.length) {
      await reqP(assets.put({ ...stored, owners: [...owners] }));
    }
    const next = {
      ...pkg,
      assets: pkg.assets.map((a) => (a.url === asset.url ? { ...a, state: 'done', size, error: null } : a)),
      updatedAt: new Date().toISOString(),
    };
    await reqP(packages.put(next));
    return next;
  });

/** Bytes freed by deleting this package: its JSON + files no other package uses. */
export const releasableBytes = (key) =>
  withTx(['packages', 'assets'], 'readonly', async ({ packages, assets }) => {
    const pkg = await reqP(packages.get(key));
    if (!pkg) return 0;
    let bytes = pkg.detailBytes || 0;
    for (const a of pkg.assets) {
      const stored = await reqP(assets.get(a.url));
      if (stored && stored.owners.length === 1 && stored.owners[0] === key) bytes += stored.size || 0;
    }
    return bytes;
  });

/** Deletes one language package; returns the freed bytes. */
export const deletePackage = (key) =>
  withTx(['packages', 'assets'], 'readwrite', async ({ packages, assets }) => {
    const pkg = await reqP(packages.get(key));
    if (!pkg) return 0;
    let freed = pkg.detailBytes || 0;
    for (const a of pkg.assets) freed += await dropOwner(assets, a.url, key);
    await reqP(packages.delete(key));
    return freed;
  });

/** Library view: packages + which files are really present + bytes used on the device. */
export const readLibrary = () =>
  withTx(['packages', 'assets'], 'readonly', async ({ packages, assets }) => {
    const list = await reqP(packages.getAll());
    const all = await reqP(assets.getAll());
    const present = new Map(all.filter((a) => a.blob).map((a) => [a.url, a]));
    const usedBytes = all.reduce((s, a) => s + (a.size || 0), 0) + list.reduce((s, p) => s + (p.detailBytes || 0), 0);
    const covers = {};
    const withState = list.map((p) => {
      const missing = p.status === 'ready' ? p.assets.filter((a) => !present.has(a.url)).length : 0;
      const coverUrl = p.detail?.coverImageUrl;
      if (coverUrl && present.has(coverUrl) && !covers[p.tourId]) covers[p.tourId] = objectUrl(present.get(coverUrl));
      return { ...p, missing };
    });
    return { packages: withState, usedBytes, covers };
  });

// ---------- offline playback ----------

const objectUrls = new Map(); // asset url -> blob: URL (kept for the session)

function objectUrl(asset) {
  if (!objectUrls.has(asset.url)) objectUrls.set(asset.url, URL.createObjectURL(asset.blob));
  return objectUrls.get(asset.url);
}

function revokeObjectUrl(url) {
  const o = objectUrls.get(url);
  if (o) {
    URL.revokeObjectURL(o);
    objectUrls.delete(url);
  }
}

function replaceUrls(value, map) {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceUrls(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceUrls(v, map);
    return out;
  }
  return value;
}

/**
 * Detail for the UC04 player from local data only (no network). `lang` falls back to the first
 * ready language of the tour. Every file comes from a blob: URL; a missing file -> OfflineDataError.
 */
export async function loadOfflineDetail(tourId, lang) {
  let found;
  try {
    found = await withTx(['packages', 'assets'], 'readonly', async ({ packages, assets }) => {
      const list = (await reqP(packages.index('tourId').getAll(tourId))).filter((p) => p.status === 'ready');
      const pkg = list.find((p) => p.language === lang) ?? list[0];
      if (!pkg) return { list };
      const files = [];
      for (const a of pkg.assets) files.push([a.url, await reqP(assets.get(a.url))]);
      return { list, pkg, files };
    });
  } catch (e) {
    throw new OfflineDataError('Không đọc được bộ nhớ trên thiết bị này', 500);
  }
  const { list, pkg, files } = found;
  if (!pkg) throw new OfflineDataError('Tour này chưa được tải về máy', 422);
  if (!pkg.detail || !Array.isArray(pkg.detail.places)) {
    throw new OfflineDataError('Dữ liệu tour trên máy bị hỏng. Hãy xoá và tải lại.', 422);
  }
  const map = new Map();
  for (const [url, stored] of files) {
    if (!stored?.blob) throw new OfflineDataError('Dữ liệu tour trên máy bị thiếu. Hãy xoá và tải lại.', 422);
    map.set(url, objectUrl(stored));
  }
  const detail = replaceUrls(pkg.detail, map);
  return {
    ...detail,
    selectedLanguage: pkg.language,
    availableLanguages: list.map((p) => p.language),
    pendingLanguages: [],
    offline: true,
  };
}
