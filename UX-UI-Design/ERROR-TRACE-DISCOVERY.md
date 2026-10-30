# Discovery crash trace and collection-contract audit

Updated: 2026-10-28. Source baseline: `develop` `1eff05e`. Fix task: [#223](https://github.com/Tran-Gia-Phuc/GeoSound/issues/223), branch `fix/discovery-result-contract`. Checklist task: [#224](https://github.com/Tran-Gia-Phuc/GeoSound/issues/224).

Fix commit: `ced43ac`; [PR #225](https://github.com/Tran-Gia-Phuc/GeoSound/pull/225) targets `develop` and is not merged at the time of this report. The local preview uses `http://localhost:5176` while its Vite process is running.

Hướng dẫn: dùng bảng D01–D15 để thử lỗi trong ảnh; bảng audit phía dưới ghi các trang có nguy cơ tương tự khi dữ liệu không đúng hợp đồng. Kết quả tự động dùng fixture được tách khỏi kiểm tra backend thật. Các ô nghiệm thu thủ công nằm trong [CHECKLIST-FRONTEND.md](CHECKLIST-FRONTEND.md), để trống đến khi người dùng kiểm tra.

## Reproduced cause

The screenshot URL `/?addTo=<itinerary-id>&city=Hội+An` lands on Tours. With a city filter, switching from Places to Tours changes `tab` during rendering while `results` still contains `{ items: [...] }`. The loading effect runs after that render. `results.tours.length` therefore throws. Switching the other way can similarly access `results.items.length` on a Tour payload. This does not require a broken backend response.

The fix associates each payload with its full query key (tab, text, city, language, type, sort and applicable coordinates). Rendering can only use a matching payload. Initial-query cleanup and pagination generations ignore obsolete responses. A synchronous request lock blocks duplicate load-more calls. Discovery API adapters reject malformed success bodies with a retryable `ApiError`; they do not reinterpret an invalid body as an empty result.

## Reproduction and regression matrix

Paths below are relative to the repository. Automated cases are in `client/test/ui/discovery-contract.spec.js`, with existing error recovery in `discover-retry.spec.js`. Results are recorded after running the suite; coverage descriptions are not manual acceptance ticks.

| ID | Trigger / data | Expected behavior | Automated coverage |
| --- | --- | --- | --- |
| D01 | Filtered Places → Tours → Places with `addTo` in list mode | Each tab renders only its own collection, no `.length` crash, itinerary context retained | `filtered tabs ... list view` |
| D02 | Same sequence on map, then list/map toggle | Markers belong to active tab; no invalid collection access | `filtered tabs ... map view`; direct URL test |
| D03 | Switch tab while load-more request is delayed | Old page cannot overwrite or append to new tab | `late pagination ...` |
| D04 | Two load-more clicks before rerender | One in-flight request, no duplicate append | `late pagination ...` |
| D05 | Change filter before previous search resolves | Late obsolete search cannot replace active filter results | `out-of-order filters ...` |
| D06 | `tours` or `items` is null/object/string/wrong-shape/null-record array | Actionable error and retry; no crash or fake empty success | 10 `rejects malformed list ...` cases |
| D07 | Null body, missing collection, missing/negative total, string page, missing item ID/title/name | Reject invalid success payload and recover on valid retry | Two `handles missing payload ...` cases |
| D08 | Invalid second page for either tab | Keep page one visible; retry page two, append valid records once | Two `keeps loaded items ...` cases |
| D09 | Popular/nearby response malformed | Distinct recoverable errors, not an empty list presented as success | `popular and nearby ...` |
| D10 | HTTP failure on initial/filtered search | Stop loading, preserve filters, retry without full reload | Existing `discover-retry.spec.js` |
| D11 | Corrupt recent-history storage (valid JSON string instead of array) | Ignore invalid optional history; discovery remains usable | `invalid recent history ...` |
| D12 | Optional place gallery contains null or invalid image records | Omit invalid optional images; place dialog opens | Same test as D11 |
| D13 | Place missing map longitude | Skip invalid marker; place remains available in list | `missing map coordinates ...` |
| D14 | Direct screenshot-shaped URL, valid empty results, reload and browser Back | No crash; URL/tab/map/itinerary context stays usable | `direct add-to URL ...` |
| D15 | Live gateway search, place search and public detail | Validate actual response compatibility, separately from fixtures | Live-only browser checks and read-only API requests |

Optional coordinate checks cover both latitude and longitude for Tour anchors and Places. Recent history validates array records before rendering. These checks do not claim to validate every possible nested field or arbitrary backend schema change.

## Trace across other collection consumers

This is a static audit of all current route families, not a statement that each risk was observed against production data. A `.length` or `.map` message alone is not sufficient to identify the Discovery race. For each other page, reproduce independently and keep its fix, test, issue and branch separate. Do not substitute `[]` for malformed required data and report success.

| Page / UC | External data and consumer | Similar-failure trigger to check | Current evidence / next verification |
| --- | --- | --- | --- |
| Discovery / UC02,07 | `DiscoverPage.jsx`, `DiscoverMap.jsx`, `PlaceDetailSheet.jsx`; `/api/tours`, `/api/places`, recent storage | Cross-tab payload, late responses, malformed arrays, invalid optional images/coordinates | Reproduced D01; scoped fix and automated matrix above |
| Tour detail / UC02 | `features/tours/TourDetailPage.jsx`; `fetchTourDetail` in `lib/api.js`; `tour.places`, `route` | Missing/wrong `places`, null place, malformed route arrays | Existing normal/404/language-failure tests; full malformed-contract coverage still planned |
| Public player / UC04 | `features/player/TourPlayerPage.jsx`, `LanguageMenu.jsx`, `PlaceList.jsx`, `hooks/usePlaybackEngine.js` | Invalid `places`/`availableLanguages`/route arrays; response while switching tour/language | Audio retry/unlock/control tests exist; malformed nested payload and rapid route changes still require dedicated tests |
| Progress storage / UC04,08 | `hooks/useTourProgress.js` | Missing/invalid JSON or `visited` not an array | JSON read is caught and `visited` uses `Array.isArray`; schema of each optional field not fully validated |
| Itinerary library / UC07 | `features/itineraries/ItinerariesPage.jsx`; `listMyItineraries` in `lib/itineraries.js` | `itineraries` absent/wrong type/null record; late result after account change | Owner/generation protection and failure/retry tests exist; malformed success body remains a contract-test follow-up |
| Add-place sheet / UC07 | `features/itineraries/AddToItinerarySheet.jsx` | Malformed itinerary list; pending request after dialog closes/reopens | `Array.isArray` prevents list crash but invalid payload can look empty; improve explicit contract error in a separate task |
| Itinerary editor / UC07 | `features/itineraries/ItineraryEditorPage.jsx`; get/add/remove/reorder API responses | Non-array places or missing places in mutation/undo result | Normal reorder/edit test exists; mutation contract/failure coverage still needed |
| Shared itinerary / UC07 | `features/itineraries/SharedItineraryPage.jsx`; `getSharedItinerary` | Missing/wrong `view.places`, late response after token change | Direct `.map` trusts backend; no claim of malformed-success or token-race protection |
| Own/shared itinerary player / UC08 | `ItineraryPlayerPage.jsx`, `SharedItineraryPlayerPage.jsx` delegate to shared player | Bad itinerary view fields, stale language response | Shares player tests; each adapter's malformed contract must be checked separately |
| Contributor tour library / UC09 | `features/studio/StudioToursPage.jsx`; `listMyTours` in `lib/studio.js` | Non-array `tours`, null record causes filter/map access | Normal list/filter tests exist; `(list || [])` handles null, not truthy wrong-type values |
| Create/edit tour / UC09 | `TourCreatePage.jsx`, `TourEditorPage.jsx`, `TourForm.jsx` | Missing created tour/id or optional text with wrong type before form `.length` | Form validation/create tests exist; mutation response contract is separate from Discovery search |
| Stops / UC10 | `PlacesManagerPage.jsx`, `PlaceForm.jsx`; `listPlaces`, `reorderPlaces`, images | Missing/non-array places or image collection; null record during form initialization | Direct collection consumers found; dedicated malformed-read/mutation cases planned |
| Address search / UC10 | `AddressSearch.jsx`, `lib/geocode.js` | Geocoder payload wrong type or results returning out of order | Adapter returns `b.results || []`; truthy non-array still needs contract validation |
| Route configuration / UC11 | `RouteConfigPage.jsx`, shared `TourMap.jsx`; `config.path/triggers/navAudios` | Truthy non-array config; malformed GeoJSON ring/coordinates | Default arrays protect absence only at some consumers; validate nested geometry separately |
| Languages / UC12 | `LanguagesPage.jsx`; `config.languages`, `config.places[].translations` | Missing/non-array config arrays or null nested record | Normal translation/preview tests exist; `hydrate` and render trust nested contracts |
| Publish/readiness / UC09,13 | `PublishPanel.jsx`; `readiness.checks`, error `missing` | Readiness missing checks, wrong type, malformed 422 missing list | Existing ordinary fixtures cover only expected schema; dedicated failure tests required |
| Contributor preview / UC13 | `App.jsx` preview adapter, `lib/studio.js`, shared player | Invalid preview collection payload or tour change | Same collection risks as player, plus authenticated ownership/422 tests |
| Auth/account / UC01 | `features/auth/*`, `features/account/*`, `auth/AuthContext.jsx`, `lib/token-store.js` | Corrupt stored user/role or missing login/refresh body | Auth-state tests cover selected failures; form strings and static role/theme arrays are not the cross-tab result bug |
| Offline, rating/report, passcode, moderation, admin / UC03,05,06,14–22 | No implemented dedicated route in `App.jsx` at audited baseline | New API contract introduced during implementation | Planned tasks in checklist; no executable frontend collection consumer to certify yet |

The audit includes `.length`, `.map`, `.filter`, `.find`, `.some`, nested arrays, API adapters and persisted collections. It is bounded to the current frontend; it cannot guarantee the absence of every runtime error or future contract regression. Tests for malformed contracts outside Discovery should be separate page tasks, and retain explicit error states rather than hiding data failures.

## Verification record

- Production client build: passed on the fix branch after updating to `1eff05e`.
- Browser suite: 66 passed, 3 live-only tests skipped in the complete 69-test run. This includes 22 new fixture-based Discovery regression cases. A new live-only Discovery spec was then added and executed separately; normal CI discovery now lists 70 tests, with that additional live test skipped unless enabled.
- Live browser run: 3 passed (public tour detail, public discovery, filtered add-to-context tab switching at desktop 1440px and phone 390px). No intercepted API fixture was used for these three tests. Captured screenshots were visually inspected; the expected filtered tour and controls rendered without the crash screen.
- Read-only live gateway requests: `/api/tours?sort=popular&page=1&limit=1` returned a valid array, total 7, page 1; `/api/places?city=Hội%20An&page=1&pageSize=1` returned a valid array, total 4, page 1. Snapshot counts can change.
- No live itinerary mutation, account change, moderation submission, email send or S3 upload is implied by these read checks.
- Local commands: `PW_CHANNEL=msedge npm run test:ui --workspace client`; `npm run build --workspace client`; `PW_CHANNEL=msedge LIVE_API_TESTS=1 npm run test:ui --workspace client -- --grep 'live (filtered discovery|discovery reads|detail connects)'` (environment-variable syntax above is shell-neutral notation; use `$env:` assignments in PowerShell).

## What still needs manual verification

- Adding a place to a real authorized test itinerary, expired login, deleted/foreign itinerary and recovery from mutation errors. The live regression retained the URL context but deliberately did not write itinerary data.
- Physical-device GPS, Safari/mobile audio and network transitions; Edge at a phone viewport is not a physical-device test.
- Malformed nested success payloads outside Discovery in the audit table. These are planned contract tests, not bugs asserted to occur with today's live backend.
- The complete 464 manual requirement checks, including backend-dependent features, remain for acceptance. Automated passing tests are not a completion claim for those requirements.
