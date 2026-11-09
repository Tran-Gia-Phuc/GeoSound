# UC10 – Thêm và quản lý địa điểm trên tour

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC10 |
| **Use Case Name** | Thêm và quản lý địa điểm trên tour |
| **Actor(s)** | Người đăng nội dung (Contributor); Hệ thống: Moderation service, AI service (khi bật kiểm duyệt) |
| **Priority** | P0 |
| **Maturity** | Implemented |
| **Summary** | Contributor thêm điểm dừng lên bản đồ (tìm địa chỉ hoặc chạm bản đồ thả ghim), nhập nội dung (tên, loại, mô tả bắt buộc, ảnh có chú thích, audio người thật tùy chọn), sắp xếp / sửa / xóa điểm. Tour kiểm vùng cấm khi lưu; khi bật kiểm duyệt, mỗi điểm được gửi cho AI quét nội dung và ảnh. |

## Basic Course of Events

| # | Actor Action | System Response |
|---|---|---|
| 1 | Contributor mở bước **Điểm dừng** (`/studio/tours/:id/places`) và chọn thêm điểm. | |
| 2 | | Hệ thống hiển thị bản đồ (bản đồ trước, form bên cạnh / bên dưới) và danh sách điểm hiện có. `PlacesManagerPage`, `listPlaces()` → `PlaceController.list()` → `ListPlaces.execute()` |
| 3 | Contributor tìm địa chỉ. *A1, E1* | |
| 4 | | Client gọi `GET /api/geocode?q=` (gateway proxy Nominatim), đặt ghim tại kết quả được chọn; ghim kéo được để chỉnh. `AddressSearch`, `searchAddress()` → `createGeocoder().handler` |
| 5 | Contributor nhập tên, loại địa điểm, **mô tả (bắt buộc)**; tải ảnh (kèm chú thích) và tùy chọn audio người thật. *E3, E4* | |
| 6 | | Mỗi file được gửi tới Media (`POST /api/media/uploads?kind=image|audio`), Media trả URL. `uploadMedia()` → `UploadMedia.execute()` |
| 7 | Contributor lưu điểm. | |
| 8 | | Tour kiểm vị trí với các vùng cấm đang bật (ray casting). *E2* `PolygonZoneChecker.assertAllowed()` → `PrismaForbiddenZoneRepository.listActive()`, `pointInPolygon()` |
| 9 | | Tour lưu điểm ở cuối danh sách (`sequence` kế tiếp); `audio_source = human` nếu có audio, ngược lại `tts`. `addPlace()` → `PlaceController.add()` → `AddPlace.execute()` → `PrismaPlaceRepository.nextSequence()`, `create()` |
| 10 | | Khi `MODERATION_EVENTS_ENABLED=true`: điểm ở `moderation_status = checking`, Tour phát `place.submitted`; Moderation gọi AI `POST /moderate/place` và trả `place.ai_passed` / `place.ai_rejected`; Tour cập nhật `approved` / `warning` / `rejected`. Client làm mới chip trạng thái mỗi 5 s khi còn điểm đang quét. *A4, E5* `submitPlaceForModeration()` → `EventModerationGateway.submitPlace()`; `RunPlaceReview` → `HttpAiReviewer.reviewPlace()` → `PlaceModerator.moderate_place()`; `ApplyModerationResult.applyPlace()` |
| 11 | | Điểm hiện trên bản đồ và trong danh sách. `PlaceModerationChip` |
| 12 | Contributor lặp lại; sắp xếp / sửa / xóa điểm. *A2, A3* | |
| 13 | | Use case kết thúc. |

## Alternative Path

**A1. Thả ghim thủ công** → chạm bản đồ đặt ghim (hoặc nhập tọa độ trong form, phương án phụ), tiếp tục bước 5. `PlacesManagerPage`, `PlaceForm`

**A2. Sắp xếp lại** → nút lên / xuống; `PATCH .../places/reorder { order: [placeId...] }` cập nhật `sequence`. `reorderPlaces()` → `ReorderPlaces.execute()` → `PrismaPlaceRepository.reorder()`

**A3. Sửa / Xóa điểm** → `PATCH .../places/:placeId` chỉ gửi trường đổi (đổi tọa độ thì kiểm lại vùng cấm; `audioUrl: null` gỡ audio người thật → về `tts`) (`updatePlace()` → `UpdatePlace.execute()`, `Place.applyEdits()`). Xóa qua hộp thoại xác nhận, `DELETE .../places/:placeId` xóa luôn bản dịch của điểm (`deletePlace()` → `DeletePlace.execute()`).

**A4. Ảnh hưởng tới tour đang kiểm duyệt.** Thêm / sửa nội dung AI đọc / xóa / sắp xếp điểm khi tour ở `ai_checking`, `ai_warning`, `pending_review` → tour rút về `draft` (`withdrawTourFromModeration()`). Sửa `name`, `description`, `images` → điểm được gửi `place.submitted` lại (`MODERATED_FIELDS`). Tour `public` vẫn giữ `public`; khi bật cờ chatbot, Tour phát lại `tour.published` (`notifyTourPublished()`).

**A5. Bản dịch theo điểm (UC12).** Thêm điểm mới, hoặc sửa `description`, thì Tour dịch ngay điểm đó sang mọi ngôn ngữ tác giả đã bật (một lượt gọi AI mỗi ngôn ngữ, `refreshPlaceTranslations()` → `EnsureTranslations.execute()`). Bản chỉnh tay (`edited`) được giữ nhưng hiện "Cần xem lại" ở bước Ngôn ngữ. AI lỗi thì điểm vẫn được lưu; ngôn ngữ đó chờ dịch cho tới lần làm mới sau (lưu lại cấu hình ngôn ngữ).

## Exception Path

- **E1.** Không tìm thấy địa chỉ → "Không tìm thấy địa chỉ phù hợp", gợi ý thả ghim (A1); dịch vụ geocoding lỗi → 503 `geocode_unavailable`. `AddressSearch`, `createGeocoder()`
- **E2.** Vị trí trong vùng cấm → 422 `forbidden_zone` ("Vị trí nằm trong vùng cấm (<tên>), vui lòng dời ra ngoài"); client vẽ vùng cấm màu đỏ, hiện tên và loại vùng, gợi ý kéo ghim ra ngoài. `ForbiddenZoneError`, `ForbiddenZoneDetails`
- **E3.** Thiếu tên hoặc mô tả → 400 `validation_error` ("Vui lòng nhập tên địa điểm", "Mô tả là bắt buộc"). `addPlaceSchema`
- **E4.** File sai định dạng → 415 `unsupported_media`; quá giới hạn → 413 `media_too_large`. `MediaFile`
- **E5.** Kết quả kiểm duyệt không Pass:
  - AI từ chối (`place.ai_rejected`) → chip "bị từ chối" kèm lý do; checklist xuất bản chặn cho tới khi sửa (UC15).
  - Ảnh AI không đọc được vĩnh viễn: GIF hoặc định dạng ngoài jpeg/png/webp, lớn hơn 3 MB, host không nằm trong allowlist, không phải https, redirect, 403/404/410, nội dung không khớp kiểu. Ảnh đó bị bỏ khỏi lần gọi Gemini, AI thêm finding `images[n]` category `other` severity 0.5 ("Không thể kiểm tra tự động ảnh n; người kiểm duyệt cần xem xét.") → điểm là **Warning**, không bao giờ Pass, không bị Reject vì lý do này. `fetch_images()`, `PlaceModerator.moderate_place()`, `unchecked_image_severity()`
  - Lỗi ảnh tạm thời (429, 5xx, timeout, lỗi mạng) → AI trả 503 (`ImagesUnavailableError`), không gọi LLM; Moderation không phát gì và thử lại sau (`RetryFailedCases`).
- **E6.** Điểm không thuộc tour → 404 `place_not_found`; tour của người khác → 403 `not_tour_owner`. `PlaceNotFoundError`, `NotTourOwnerError`

## Extension Points

- UC11 – Route & kích hoạt; UC12 – Đa ngôn ngữ & TTS; UC13 – Xem thử; UC15 – Gửi tour đi duyệt.

## Triggers

Contributor cần tạo nội dung các điểm dừng cho tour.

## Assumptions

- Dịch vụ geocoding (qua gateway) khả dụng; nếu không, contributor vẫn thả ghim được.

## Preconditions

- Tour đã tạo (UC09) và thuộc contributor đang đăng nhập (role `contributor`).

## Post Conditions

- Dòng mới / cập nhật trong `tour.places` (tọa độ, nội dung, ảnh, audio, `sequence`); khi bật kiểm duyệt có `moderation_status`, `moderation_reasons`, `moderation_revision` và một sự kiện `place.submitted`.

## Reference: Business Rules

- Tên 1–200 ký tự; **mô tả bắt buộc**, tối đa 5000 ký tự (sự kiện `place.submitted` cắt còn 2000).
- Tối đa 20 ảnh mỗi điểm, chú thích tối đa 300 ký tự; `place.submitted` mang 5 ảnh đầu. Upload: ảnh JPG/PNG/WebP/GIF tối đa 8 MB, audio MP3/M4A/AAC/WAV/OGG/WebM tối đa 25 MB.
- Media nhận GIF và ảnh tới 8 MB, nhưng AI chỉ quét jpeg/png/webp tới 3 MB (`IMAGE_MAX_BYTES`): ảnh GIF hoặc ảnh 3–8 MB luôn đưa điểm về Warning để Admin xem.
- Loại địa điểm: `landmark, museum, historical, nature, food, shopping, entertainment, other`.
- Vùng cấm (quân sự, trường học, bệnh viện, lãnh sự quán...) do **Tour** kiểm khi lưu điểm, không phải Moderation.
- Kiểm duyệt điểm (UC15): AI quét text và ảnh bằng Gemini trong một lần gọi; `policy.py`: severity ≥ 0.8 Reject, ≥ 0.4 Warning. Warning không chặn xuất bản; `checking` / `rejected` thì chặn.
- Không có audio người thật → trình phát đọc mô tả bằng giọng của thiết bị (UC12).
- Bản dịch đi theo mô tả: mỗi bản dịch lưu `source_hash` của mô tả đã dùng để dịch; mô tả đổi thì bản dịch máy cũ không còn được phát và được dịch lại (UC12).

## Hiện thực trong hệ thống

- **Dịch vụ:** Client (bản đồ, form, chip kiểm duyệt); Gateway (`/api/geocode` tự xử lý); Tour (lưu điểm, vùng cấm, phát `place.submitted`, nhận kết quả); Media (ảnh, audio); Moderation + AI (quét điểm khi bật cờ).
- **Màn hình (client):** `/studio/tours/:id/places` (`PlacesManagerPage`, `PlaceForm`, `AddressSearch`, `ForbiddenZoneDetails`, `PlaceModerationChip`); API `client/src/lib/studio.js`, `lib/geocode.js`, `lib/media.js`.
- **API (qua gateway):**
  - `GET|POST /api/tours/mine/:tourId/places`
  - `PATCH /api/tours/mine/:tourId/places/reorder`
  - `PATCH|DELETE /api/tours/mine/:tourId/places/:placeId`
  - `GET /api/geocode?q=`, `POST /api/media/uploads?kind=image|audio`
- **Sự kiện (RabbitMQ):** phát `place.submitted`; nhận `place.ai_passed` / `place.ai_rejected` (cờ `MODERATION_EVENTS_ENABLED`); `tour.published` khi tour công khai đổi nội dung (cờ `CHATBOT_EVENTS_ENABLED`).
- **Dữ liệu:** `tour.places` (`name, type, description, lat, lng, sequence, images, audio_url, audio_source, moderation_status, moderation_reasons, moderation_revision`); `tour.forbidden_zones` (`name, type, geometry` GeoJSON Polygon, `active`).
- **Tài liệu thiết kế:** [moderation-architecture.md](../../02-design/moderation-architecture.md).
- **Giới hạn đã biết:** vùng cấm là dữ liệu seed, chưa có màn hình admin để sửa.
- **Mã nguồn chính:**

| Bước | Hàm / lớp | File |
|---|---|---|
| 2, 8, 11 | `PlacesManagerPage`, `PlaceForm`, `ForbiddenZoneDetails`, `PlaceModerationChip` | `client/src/features/studio/` |
| 2, 9, A2, A3 | `listPlaces()`, `addPlace()`, `updatePlace()`, `deletePlace()`, `reorderPlaces()` | `client/src/lib/studio.js` |
| 4 | `AddressSearch`, `searchAddress()` | `client/src/features/studio/AddressSearch.jsx`, `client/src/lib/geocode.js` |
| 4 | `createGeocoder()` | `gateway/src/geocode.js` |
| 6 | `uploadMedia()`, `UploadMedia.execute()` | `client/src/lib/media.js`, `services/media/src/application/use-cases/upload-media.js` |
| 9 | `buildPlaceRouter()`, `PlaceController` | `services/tour/src/interfaces/http/routes/place-routes.js`, `controllers/place-controller.js` |
| 9, E3 | `addPlaceSchema`, `updatePlaceSchema`, `reorderPlacesSchema` | `services/tour/src/application/dtos/place-schemas.js` |
| 9 | `AddPlace.execute()` | `services/tour/src/application/use-cases/add-place.js` |
| A2, A3 | `UpdatePlace`, `DeletePlace`, `ReorderPlaces` | `services/tour/src/application/use-cases/update-place.js`, `delete-place.js`, `reorder-places.js` |
| A5 | `refreshPlaceTranslations()`, `EnsureTranslations` | `services/tour/src/application/use-cases/ensure-translations.js` |
| 8 | `PolygonZoneChecker.assertAllowed()`, `pointInPolygon()` | `services/tour/src/infrastructure/zone/polygon-zone-checker.js`, `point-in-polygon.js` |
| 8 | `PrismaForbiddenZoneRepository.listActive()` | `services/tour/src/infrastructure/persistence/prisma-forbidden-zone-repository.js` |
| 9 | `PrismaPlaceRepository` (`create`, `nextSequence`, `reorder`, `updateModeration`) | `services/tour/src/infrastructure/persistence/prisma-place-repository.js` |
| 10 | `submitPlaceForModeration()`, `EventModerationGateway.submitPlace()` | `services/tour/src/application/use-cases/submit-for-moderation.js`, `infrastructure/messaging/event-moderation-gateway.js` |
| 10 | `createPlaceSubmittedHandler()`, `RunPlaceReview`, `HttpAiReviewer.reviewPlace()` | `services/moderation/src/interfaces/events/place-submitted-consumer.js`, `application/use-cases/run-place-review.js`, `infrastructure/ai/http-ai-reviewer.js` |
| 10, E5 | `PlaceModerator.moderate_place()`, `fetch_images()` | `services/ai/app/moderation/place_service.py`, `images.py` |
| 10 | `ApplyModerationResult.applyPlace()` | `services/tour/src/application/use-cases/apply-moderation-result.js` |

## Author(s)

(điền sau)

## Date

Tạo: 2026-10-18 · Cập nhật theo hệ thống: 2026-11-09

## Activity Diagram

[UC10-activity.xml](../../02-design/drawio/activity/UC10-activity.xml) (draw.io: File → Import from → Device). Nguồn: [specs/UC10.json](../../02-design/drawio/activity/specs/UC10.json).

## Sequence Diagram

```mermaid
sequenceDiagram
    actor C as Contributor
    participant Client
    participant Gateway
    participant Tour
    participant RabbitMQ
    participant Moderation
    participant AI
    C->>Client: Tìm địa chỉ / thả ghim, nhập nội dung
    Client->>Gateway: GET /api/geocode?q=
    Gateway-->>Client: results[]
    Client->>Gateway: POST /api/tours/mine/:tourId/places
    Gateway->>Tour: POST /mine/:tourId/places
    Tour->>Tour: kiểm vùng cấm, lưu (checking)
    Tour-)RabbitMQ: place.submitted
    Tour-->>Client: 201 { place }
    RabbitMQ-)Moderation: place.submitted
    Moderation->>AI: POST /moderate/place
    AI-->>Moderation: verdict, reasons
    Moderation-)RabbitMQ: place.ai_passed / place.ai_rejected
    RabbitMQ-)Tour: kết quả, cập nhật moderation_status
    Client->>Gateway: GET .../places (mỗi 5 s)
```

## Boundary

Bước Điểm dừng (`/studio/tours/:id/places`): bản đồ thêm điểm (tìm địa chỉ / thả ghim), form nội dung điểm, danh sách điểm (lên / xuống, sửa, xóa), chi tiết vùng cấm, chip trạng thái kiểm duyệt AI.
