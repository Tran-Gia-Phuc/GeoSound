# UC03 offline tour download

Use case: `docs/use case/lam-truoc/UC03-quan-ly-tour-offline.md`. Frontend issues: #103 (download),
#104 (pause / resume), #158 (library), #159 (delete one language), #160 (empty library), #161 (not
enough space). Statistics: UC17 activity `download` (`uc17-tour-stats.md`).

## 1. Goal and actors

A tourist (no account needed) downloads a public tour in one or more languages, listens to it
without network, sees what is stored on the device and frees space per language.

## 2. Rules

- R1 A package = one tour + one language: the detail the player needs (tour, stops with the text
  of that language, route and trigger zones), the images (cover, place images) and the audio files
  of that language (human recordings; pre-rendered TTS files if the TTS ever returns real URLs).
- R2 A stop without an audio file is read by the device voice offline (the existing TTS fallback
  of `useAudioController`). Placeholder `tts://` URLs are not files and become `null`.
- R3 A package is "ready" only when every file of its manifest is stored. Progress shows real
  numbers only: files done / total, bytes of stored Blobs, the Content-Length estimate.
- R4 Pause keeps every stored file; resume downloads only the files still missing; a file cut in
  the middle is downloaded again. A reload or a crash during a transfer is shown as "Bị gián đoạn"
  on the next visit and resumes the same way.
- R5 Images shared by two languages of a tour are stored once; deleting one language frees only
  the files no other language uses (the confirmation shows those real bytes).
- R6 Not enough space (estimate before, `QuotaExceededError` during) stops the transfer, shows the
  required / available bytes when known and a link to the library; other packages are untouched
  and the failed one is never marked ready.
- R7 After a package becomes ready the client sends `recordTourActivity(tourId, 'download',
  { language })` once per package (flag stored with the package; the server also dedups per day).
- R8 No account: packages belong to the device (browser profile), not to a user.

## 3. Data

Backend: no schema change. Client, IndexedDB `geosound-offline` v1 (`client/src/lib/offline-store.js`,
plain wrapper, no new dependency):

| Store | Key | Value |
| --- | --- | --- |
| `packages` (index `tourId`) | `"<tourId>\|<language>"` | `tourId, language, title, revision, detail, detailBytes, assets[{url, kind, placeId, state: pending\|done\|error, size, error}], status: downloading\|paused\|ready, pauseReason: user\|interrupted\|offline\|error\|quota\|starting, estimate{bytes, unknown}, createdAt, updatedAt, readyAt, downloadReported` |
| `assets` | file URL | `url, tourId, kind, type, size (Blob.size), blob, owners[packageKey]` |

`owners` is the reference count of R5. `detailBytes` is the size of the stored JSON. Sizes are never
invented: a file without Content-Length counts as "chưa rõ dung lượng" in the estimate.

## 4. API (Tour, through the gateway, public)

`GET /api/tours/:id/package?lang=xx` (no auth). Use case `GetTourPackage`
(`services/tour/src/application/use-cases/get-tour-package.js`), same repositories as the detail.

```json
{ "tourId": "…", "language": "vi", "revision": "2026-11-03T00:00:00.000Z",
  "detail": { "...": "buildTourDetailView, audio that is not a file -> null" },
  "assets": [ { "url": "http://localhost:8080/api/media/files/a.jpg", "kind": "image", "placeId": "p1" },
              { "url": "…/p1-vi.mp3", "kind": "audio", "placeId": "p1" } ] }
```

- `revision` = newest `updatedAt` of the tour, its places, its route config and the translations of
  that language (the tour `updatedAt` alone misses place and translation edits).
- `assets`: cover, place images, place audio, route audio (`navAudios`, `nextHint`), deduplicated by
  URL; only `http(s)` URLs and same-origin paths. URLs stay as stored (absolute media URLs); the
  client rewrites local gateway URLs like every response (`media-url.js`, #263).
- Errors: 404 `tour_not_found` (not public: draft, hidden, restricted, deleted), 400
  `language_not_available` (language not configured or not fully translated), 400 bad UUID.
- No sizes: Tour does not know file sizes. The client sends `HEAD` per missing file and sums
  `Content-Length` for the estimate.

## 5. Events

None. The UC17 beacon is the existing `POST /api/tours/:id/activity` (`action: download`).

## 6. Client

| Route / place | State (issue) |
| --- | --- |
| Tour detail, section "Tải về để nghe offline" (`features/offline/OfflineDownload.jsx`) | language checkboxes, "Tải xuống (n ngôn ngữ)", progress, Tạm dừng / Tiếp tục / Huỷ, failed files with "Thử lại", no network notice, ready size + "Mở bản offline" (#103, #104) |
| `PackageProgress.jsx` | live, paused, interrupted, offline, failed files, not enough space with required / available and "Quản lý tour đã tải" (#104, #161) |
| `/offline` (`OfflineLibraryPage.jsx`, link in Tài khoản for everyone) | loading, storage error with "Thử lại", empty with "Tìm tour" (#160), tours with languages, real size, content and download dates, "Có bản mới" / "Tour không còn công khai" (online only), missing files notice, Nghe / Đi tour, Xoá with real releasable bytes and failure toast (#158, #159) |
| `/offline/:tourId/play` | the UC04 player with `loadDetail` from IndexedDB, every file a `blob:` URL; languages = downloaded ones; missing data -> error with a link to the library; no beacons, no report button |

Transfers run in a module singleton (`lib/offline-download.js`): one AbortController per package,
3 files at a time, per-file state written after each file, so navigation inside the app does not stop
a download. `navigator.storage.persist()` is requested when a package becomes ready.

## 7. Offline app shell

The production build's service worker (vite-plugin-pwa, `vite.config.js` `workbox`) precaches the
app shell and answers every navigation with `index.html` (except `/api/`), so `/offline` and the
offline player open without network. Tour data is never cached by the service worker. The Vite dev
server used in Docker does not run the service worker: test true offline with
`npx vite build && npx vite preview`, open the app once online, then switch the network off.

## 8. Choices and limits

- Updating a package ("Cập nhật" when "Có bản mới") rewrites it: until all changed files are stored
  it is not ready again (unchanged URLs are kept, so only new files are downloaded).
- Map tiles are not part of the package: offline the map shows the route and stops without the base
  map. GPS mode still works offline.
- Images on another host must send CORS headers; otherwise that file fails with a retry and the
  package is not ready.
- No pre-rendered TTS on the server (UC03 step 3): the device voice reads stops without audio.
- Tests: `services/tour/test/tour-package.test.js`; `client/test/ui/offline.spec.js` (mocked
  manifest and media, `context.setOffline(true)`, reload mid-download, quota stubs).

## Itinerary packages (updated 2026-11-08)

UC07 A3: `GET /api/itineraries/:id/package?lang=` (owner only, `GetItineraryPackage`) returns the same shape
as the tour package (`buildItineraryView` + `buildPackageAssets`, revision = newest of the itinerary
`updatedAt` and the items `createdAt`). The client stores it under the device id `itinerary:<id>`
(`itineraryPackageId()`), so the library, the offline player and the update check work unchanged;
`fetchTourPackage()` picks the itinerary route from the prefix, and no UC17 beacon is sent.
