# UC04 – Nghe tour (tại chỗ theo GPS / nghe thử từ xa)

| Trường | Nội dung |
|---|---|
| **Use Case Number** | UC04 |
| **Use Case Name** | Nghe tour (tại chỗ theo GPS / nghe thử từ xa) |
| **Actor(s)** | Khách du lịch (Tourist), không cần đăng nhập |
| **Priority** | P0 |
| **Maturity** | Implemented |
| **Summary** | Trình phát (`/tour/:id/play`) có hai chế độ: **Đi theo GPS** — trình duyệt theo dõi vị trí, tự phát nội dung khi vào vùng kích hoạt của một điểm, phát audio chỉ đường ở ngã rẽ và gợi ý "đi tiếp"; **Nghe thử từ xa** — chọn điểm thủ công, không cần GPS. Điểm có audio thu âm thì phát tệp; điểm không có audio được đọc bằng **giọng của thiết bị** (Web Speech). Tiến độ lưu trên máy. Toàn bộ logic chạy trên client nên tour đã tải (UC03) nghe được không cần mạng. |

## Basic Course of Events *(Đi theo GPS)*

| # | Actor Action | System Response |
|---|---|---|
| 1 | Tourist ở chi tiết tour (UC02) nhấn **"Bắt đầu đi tour"** (muốn nghe trước khi đến → *A5*). | |
| 2 | | Client mở `/tour/:id/play?mode=gps&lang=`, tải chi tiết tour (`GET /api/tours/:id?lang=`): điểm dừng, text, audio, route, vùng kích hoạt, `navAudios`. *E4* |
| 3 | | Client xin quyền vị trí và hiện bản đồ: vị trí hiện tại, route, các điểm (đã nghe / đang phát). *E1, E2* |
| 4 | Tourist di chuyển theo route. | |
| 5 | | Mỗi lần vị trí đổi, client kiểm tra vị trí có nằm trong vùng kích hoạt nào (tròn hoặc đa giác). |
| 6 | Tourist bước vào **vùng kích hoạt** của một điểm. | |
| 7 | | Client **tự phát** điểm đó: audio thu âm nếu có, nếu không thì giọng thiết bị đọc text. Gửi beacon `play` (UC17) ở điểm đầu tiên. *A1, A2, E3* |
| 8 | | Sheet điểm hiện tên, text và ảnh. |
| 9 | Tourist bước vào **vùng chỉ đường** (ngã rẽ). | |
| 10 | | Nếu không đang phát gì, client phát audio chỉ đường của vùng đó. |
| 11 | | Phát xong một điểm (không phải chọn tay), client phát **gợi ý "đi tiếp"** (`nextHint`) nếu tác giả đã cấu hình; banner cho biết điểm tiếp theo và khoảng cách. |
| 12 | Tourist điều khiển: phát / tạm dừng, tua, điểm trước / sau, đổi ngôn ngữ, mở danh sách điểm. *A3* | |
| 13 | Tourist đến và nghe xong điểm cuối. *A4* | |
| 14 | | Client đánh dấu hoàn thành, gửi beacon `complete` (UC17) và hiện hộp hoàn thành với link **Đánh giá tour** (UC05) và **Khám phá tour khác**. |
| 15 | | Use case kết thúc tại đây. |

## Alternative Path

**A1. Vào nhiều vùng cùng lúc** → client phát điểm có **độ ưu tiên** (`priority`, tác giả đặt ở UC11) cao nhất, quay về bước 8.

**A2. Đang phát thì vào vùng điểm khác** → ưu tiên cao hơn điểm đang phát thì chen ngang ngay; bằng hoặc thấp hơn thì hoãn, phát sau khi xong nếu Tourist vẫn đứng trong vùng đó. Quay về bước 7.

**A3. Chọn điểm thủ công** → Tourist chạm điểm trên bản đồ hoặc trong danh sách; client phát ngay điểm đó (không phát gợi ý "đi tiếp"), quay về bước 8.

**A4. Tạm rời và quay lại** → tiến độ (điểm đã nghe, điểm cuối, ngôn ngữ) lưu trong `localStorage` theo tour; mở lại thì banner *"Bạn đã nghe x/n điểm"* cho nghe tiếp, quay về bước 5.

**A5. Nghe thử từ xa (không cần GPS).**

| # | Actor Action | System Response |
|---|---|---|
| A5.1 | Tourist nhấn **"Nghe thử"** ở chi tiết tour (hoặc chạm một điểm, `?stop=<id>`). | |
| A5.2 | | Client mở `/tour/:id/play?mode=remote`: bản đồ + danh sách điểm + thanh phát, không dùng GPS. |
| A5.3 | Tourist chọn một điểm, chuyển điểm trước / sau, đổi ngôn ngữ. | |
| A5.4 | | Client phát điểm (audio thu âm hoặc giọng thiết bị) và hiện text / ảnh. Nghe hết các điểm → hộp hoàn thành như bước 14. |

**A6. Báo cáo tour** → nút "Báo cáo tour" trên thanh trên của trình phát (UC06, chỉ tour công khai).

## Exception Path

- **E1.** Chưa có / bị từ chối quyền vị trí → *"Chưa có quyền vị trí. Hãy cấp quyền vị trí, hoặc chuyển sang nghe thử từ xa."* kèm nút **Nghe thử** (A5). Thiết bị không có GPS → *"Thiết bị không hỗ trợ GPS"*.
- **E2.** GPS yếu (sai số > 50 m) → *"GPS yếu (±x m). Bạn có thể chọn điểm thủ công."*; vị trí không cập nhật quá 12 giây → *"Tín hiệu vị trí chưa cập nhật. Đang chờ GPS…"*.
- **E3.** Tệp audio thiếu hoặc lỗi → client chuyển sang giọng thiết bị đọc text; vẫn lỗi → mở sheet điểm, hiện text kèm thông báo lỗi.
- **E4.** Không tải được tour: mất mạng → *"Mất kết nối mạng"*, *"Tour chưa tải về sẽ cần có mạng..."* + **Thử lại**; tour không công khai → `404` *"Tour không tồn tại hoặc chưa công khai."*. Tour đã tải thì mở bản offline `/offline/:tourId/play` (UC03 A3).

## Extension Points

- UC02 – Tìm & xem tour (mở trình phát); UC03 – bản offline; UC05 – Đánh giá (từ bước 14); UC06 – Báo cáo; UC17 – Thống kê (beacon `play`, `complete`).
- Cùng trình phát được dùng lại cho UC08 (đi theo lịch trình), UC13 (xem thử của tác giả, có đi bộ mô phỏng) và UC14 (bản truy cập hạn chế).

## Triggers

Tourist bắt đầu đi tour tại hiện trường, hoặc muốn nghe thử trước khi đến.

## Assumptions

- Thiết bị có GPS và trình duyệt hỗ trợ Geolocation (chế độ GPS) và Web Speech (đọc điểm không có audio). Trang mở qua HTTPS hoặc `localhost` để trình duyệt cho dùng vị trí.

## Preconditions

- Tour `public` (hoặc đã tải về máy, UC03). Có ít nhất một điểm dừng. Vùng kích hoạt lấy từ UC11; nếu tác giả chưa cấu hình, Tour tự sinh.

## Post Conditions

- Các điểm đã nghe được lưu trong `localStorage` của máy; thống kê tour có thêm `play` / `complete` (chỉ tour công khai online).

## Reference: Business Rules

| Quy tắc | Giá trị |
|---|---|
| Nguồn âm thanh | Audio thu âm (`audioSource` = `human`) khi ngôn ngữ chọn = ngôn ngữ gốc; còn lại giọng thiết bị đọc text đã dịch. Server không tạo tệp TTS |
| Vùng kích hoạt mặc định | Tròn bán kính 50 m quanh mỗi điểm, `priority` 0, khi tác giả chưa cấu hình |
| Giới hạn cấu hình (UC11) | Bán kính > 0 và ≤ 100 km; `priority` số nguyên 0 đến 1000 |
| Chồng vùng | Ưu tiên cao nhất thắng; ưu tiên cao hơn chen ngang, bằng / thấp hơn thì chờ |
| Audio chỉ đường | Chỉ phát khi không đang phát nội dung khác |
| Gợi ý "đi tiếp" | Chỉ ở chế độ GPS và khi điểm được kích hoạt tự động |
| GPS yếu | Sai số > 50 m; vị trí cũ hơn 12 giây = chưa cập nhật |
| Beacon thống kê | `play`, `complete` mỗi loại một lần mỗi lượt mở; server lọc trùng theo ngày; không gửi ở bản offline, xem thử, hạn chế |

## Hiện thực trong hệ thống

- **Dịch vụ:**
  - Client: toàn bộ logic phát (`hooks/usePlaybackEngine.js`, `useAudioController.js`, `useGeolocation.js`, `useTourProgress.js`, `lib/zones.js`).
  - Gateway: `/api/tours` → Tour; `/api/media` → Media (tệp audio, ảnh).
  - Tour: trả chi tiết tour kèm route và vùng kích hoạt (tự sinh phần thiếu); ghi beacon thống kê.
- **Màn hình (client):** `/tour/:tourId/play` (`features/player/TourPlayerPage.jsx`, `TourMap.jsx`, `PlayerBar.jsx`, `PlaceSheet.jsx`, `PlaceList.jsx`, `LanguageMenu.jsx`, `CompletionDialog.jsx`), `/offline/:tourId/play`.
- **API (qua gateway):**
  - `GET /api/tours/:id?lang=`
  - `GET /api/media/files/...` (audio, ảnh)
  - `POST /api/tours/:id/activity` (`play`, `complete`, UC17)
- **Dữ liệu:** `places` (`audio_url`, `audio_source`, `images`), `place_translations` (text theo ngôn ngữ), `route_configs` (`path`, `triggers`, `nav_audios`); phía client `localStorage` tiến độ.
- **Tài liệu thiết kế:** [uc17-tour-stats.md](../../02-design/uc17-tour-stats.md), [offline-download.md](../../02-design/offline-download.md).
- **Giới hạn đã biết:**
  - Không có TTS phía server: chất lượng giọng đọc phụ thuộc giọng có sẵn trên thiết bị.
  - Bản đồ khi offline không có lớp nền.

## Author(s)

(điền sau)

## Date

Tạo: 2026-10-18 · Cập nhật theo hệ thống: 2026-11-08

## Activity Diagram

(bổ sung sau)

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant Gateway
    participant Tour
    participant Media
    Client->>Gateway: GET /api/tours/:id?lang=vi
    Gateway->>Tour: GET /:id?lang=vi
    Tour-->>Client: places, route.triggers, route.navAudios
    loop mỗi lần vị trí GPS đổi
        Client->>Client: triggersAt(pos) theo priority
        alt vào vùng điểm có audio
            Client->>Gateway: GET /api/media/files/...
            Gateway->>Media: GET tệp audio
            Media-->>Client: audio
        else điểm không có audio
            Client->>Client: Web Speech đọc text
        end
    end
    Client-)Gateway: POST /api/tours/:id/activity {action: play}
    Client-)Gateway: POST /api/tours/:id/activity {action: complete}
```

## Boundary

- Trình phát `/tour/:tourId/play` (thanh trên: thoát, chế độ, ngôn ngữ, danh sách điểm, báo cáo; bản đồ GPS + route + điểm; băng cảnh báo GPS; thanh phát; sheet nội dung điểm).
- Danh sách điểm (nghe thử từ xa), hộp hoàn thành tour.
- Trình phát offline `/offline/:tourId/play`.
