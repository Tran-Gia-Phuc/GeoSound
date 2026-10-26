# Kế hoạch thiết kế lại UX — GeoSound client

> Ngày: 2026-10-26 · Phạm vi: `client/src` + vài API nhỏ bắt buộc để mở khoá luồng.
> Cơ sở: 13 đặc tả trong `docs/use case/lam-truoc/`, đọc toàn bộ code client, chạy thử app thật
> (`docker compose up`, viewport điện thoại 360×732 và desktop 1366), mock phiên contributor để xem Studio.

---

## 0. Tóm tắt

Người dùng "không dùng được" chủ yếu không phải vì từng màn xấu. Nguyên nhân là **luồng bị đứt** ở những chỗ người dùng không còn đường đi tiếp.

**4 chỗ chặn (🔴)**

1. **Tác giả không xuất bản được tour.** Tour service không có use-case/endpoint nào chuyển `draft → public` ([tour-routes.js](../../services/tour/src/interfaces/http/routes/tour-routes.js) chỉ có CRUD). Tour mới tạo không bao giờ đến được khách, nên vòng đời nội dung bị đứt.
2. **Không ai trở thành tác giả được.** Form đăng ký không cho chọn vai trò, dù backend đã nhận `role: 'contributor'` ([schemas.js:16](../../services/auth/src/application/dtos/schemas.js#L16)). Màn chặn Studio bảo "liên hệ quản trị viên", nhưng app chưa có giao diện admin. Backend có quên mật khẩu, client thì chưa.
3. **Tạo nội dung đòi kỹ năng lập trình.** Ảnh bìa, ảnh điểm, audio người thật và audio chỉ đường đều là ô **dán URL**. Vị trí điểm là hai ô **lat/lng**. Media service mới là khung rỗng.
4. **Xem thử và đi tour theo GPS gặp ngõ cụt khi chưa cấu hình route.** Route mặc định rỗng. Muốn có route, tác giả phải sang màn khác, bấm "Tạo theo thứ tự điểm dừng" rồi bấm thêm "Lưu cấu hình". Nếu không, Xem thử trả 422 và màn lỗi chỉ có nút "Thử lại" (bấm cũng vô ích). Với khách thì không có vùng kích hoạt nào, nên chế độ GPS **không tự phát gì cả**.

**Lỗi hiển thị ai cũng thấy ngay:** ảnh điểm dừng luôn vỡ trong trình phát, nhãn giọng hiện chữ thô `tts`, điểm dừng đánh số từ 0, các nút dạng link bị gạch chân, mã "UC02/UC12/UC13" và UUID lộ ra cho người dùng, hộp thoại hoàn thành tour có chọn sao giả.

**Hướng thiết kế lại**

- **App shell có thanh tab theo vai trò** (Khám phá · Lịch trình · Studio · Tài khoản), thay cho 7 kiểu header rời rạc hiện nay. Cấu trúc này khớp IA trong bản demo [geosound-demo.html](demo/geosound-demo.html).
- **Gộp Trang chủ, Tìm tour và Khám phá địa điểm** thành một màn Khám phá, có nội dung hiển thị ngay khi mở.
- **Chi tiết tour là màn quyết định duy nhất**, có thanh hành động dính đáy. Bỏ màn intro trùng lặp của trình phát.
- **Studio thành quy trình có checklist**, dẫn tới nút **Xuất bản**. Route và vùng kích hoạt tự sinh mặc định. Chọn vị trí bằng bản đồ hoặc tìm địa chỉ. Upload file thay cho dán URL.

---

## 1. Ký hiệu

Mức độ: 🔴 **Chặn**: không hoàn thành được mục tiêu UC · 🟠 **Nặng**: làm được nhưng dễ sai hoặc bỏ cuộc · 🟡 **Vừa** · ⚪ **Nhẹ**.
Cột **P** là phase sửa trong [§6](#6-lộ-trình-triển-khai).

---

## 2. Trace từng use case

### UC01: Đăng ký / Đăng nhập

**Đặc tả:** khi đăng ký chọn loại tài khoản (Khách / Người đóng góp) và xác thực OTP; có quên mật khẩu; đăng nhập xong thì điều hướng theo vai trò. Khách không bắt buộc đăng ký.
**Hiện trạng:** [LoginPage.jsx](../../client/src/features/auth/LoginPage.jsx) có tab Đăng nhập/Đăng ký → OTP → tự đăng nhập → quay về `?next`, mặc định là `/`.

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Đăng ký không gửi `role` ([auth.js:21](../../client/src/lib/auth.js#L21)), nên mọi tài khoản mới là tourist và Studio không thể tiếp cận | Bước đăng ký có 2 thẻ chọn "Tôi đi du lịch" / "Tôi tạo tour audio", rồi gửi `role` | 1 |
| 🟠 | Không có Quên mật khẩu (A2), dù `/forgot-password` và `/reset-password` đã có | Thêm liên kết dưới ô mật khẩu và màn 2 bước: email → OTP + mật khẩu mới | 1 |
| 🟠 | Không điều hướng theo vai trò (bước 6): contributor đăng nhập xong về `/` ([LoginPage.jsx:87](../../client/src/features/auth/LoginPage.jsx#L87)) | Nếu không có `next`: contributor về `/studio`, tourist về `/` | 1 |
| 🟡 | Lời dẫn luôn là "Đăng nhập để tạo và đi theo lịch trình…", kể cả khi người dùng bị chặn ở Studio | Lời dẫn theo ngữ cảnh của `next` | 2 |
| 🟡 | Không đếm ngược hạn OTP (BR: 2 phút); "Gửi lại" bấm liên tục được | Hiện đếm ngược, khoá "Gửi lại" trong 30 giây | 2 |
| ⚪ | Không có nút hiện/ẩn mật khẩu | Thêm nút hiện/ẩn | 2 |

### UC02: Tìm & xem tour

**Đặc tả:** vừa vào đã thấy ô tìm, bộ lọc và **danh sách tour phổ biến/gợi ý**. Chi tiết tour có ảnh, route, đánh giá, nhãn giọng và chọn ngôn ngữ. Hành động: Tải / Nghe thử từ xa / Bắt đầu.
**Hiện trạng:** [HomePage.jsx](../../client/src/features/home/HomePage.jsx) có một "ô tìm" thực chất là link sang `/tours`, 2 thẻ điều hướng, mục dev "Mở nhanh bằng mã tour" và câu "Mẹo: từ chi tiết tour (UC02)…". Trang chủ **không hiển thị tour nào**, dù DB có 7 tour công khai. [ToursPage.jsx](../../client/src/features/tours/ToursPage.jsx) đủ chức năng nhưng khó dùng trên điện thoại.

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🟠 | Trang chủ trống: khách mới không biết app có gì; bấm "ô tìm" (thực ra là link) rồi phải gõ lại ở màn khác | Gộp thành màn **Khám phá**: ô tìm thật, chip thành phố, mục "Gần bạn" và "Phổ biến" hiện ngay | 2 |
| 🟠 | Ở 360px, ô tìm + 3 bộ lọc + chip sắp xếp chiếm hết màn đầu; thẻ tour đầu tiên nằm dưới nếp gấp | Đưa bộ lọc vào bottom sheet "Bộ lọc (n)"; trên màn chỉ giữ ô tìm và 1 hàng chip | 2 |
| 🟡 | Lọc không nhất quán: từ khoá chỉ áp khi bấm Tìm, thành phố áp khi rời ô ([ToursPage.jsx:192](../../client/src/features/tours/ToursPage.jsx#L192)), ngôn ngữ/loại áp ngay | Áp tất cả ngay; ô chữ debounce 300 ms | 2 |
| 🟡 | Bộ lọc và kết quả không nằm trong URL: vào chi tiết rồi quay lại là mất | Đồng bộ state vào `useSearchParams` | 2 |
| 🟠 | Nút "Nghe tour" ở y≈1227px trên màn cao 732px: phải cuộn qua bản đồ, danh sách điểm và đánh giá mới thấy | **Thanh hành động dính đáy**: [Nghe thử] [Bắt đầu đi tour] | 2 |
| 🟠 | "Nghe tour" mở **màn intro thứ hai** gần y hệt (ảnh bìa, tên, chip, mô tả) rồi mới cho chọn GPS / Nghe thử | Chọn chế độ ngay ở chi tiết; trình phát mở thẳng theo `?mode=gps\|remote` | 2 |
| 🟠 | Nhãn giọng hiện chữ thô `tts`: API trả mã `human`/`tts` ([voice.js](../../services/tour/src/domain/value-objects/voice.js)), client in thẳng ra, và regex `/người/` ([TourCard.jsx:9](../../client/src/features/tours/TourCard.jsx#L9)) không bao giờ khớp | Map mã sang "Giọng người thật" / "Giọng đọc máy" ở một chỗ (`lib/format.js`) | 0 |
| 🟡 | Điểm dừng đánh số từ **0** (lấy `sequence` 0-based), ở chi tiết, ghim bản đồ, trình phát và Studio | Hiển thị `index + 1` ở mọi nơi | 0 |
| 🟡 | Không bấm được vào điểm dừng để nghe thử một điểm | Bấm điểm → sheet nội dung + "Nghe thử điểm này" + "＋ Lịch trình" | 2 |
| 🟡 | Nút "Tải để nghe offline (sắp có)" bị vô hiệu, là nút chết | Ẩn cho tới khi làm UC03 | 0 |
| 🟡 | Nút quay lại cố định về `/tours` ([TourDetailPage.jsx:20](../../client/src/features/tours/TourDetailPage.jsx#L20)), kể cả khi khách đến từ trang chủ hay link chia sẻ | Quay lại theo lịch sử trong app; nếu không có thì về `/` | 2 |
| ⚪ | Thời lượng hiển thị khác nhau giữa 2 màn ("1 giờ 15 phút" và "75 phút") | Dùng chung `formatMinutes` | 0 |

### UC04: Nghe tour (GPS / nghe thử từ xa)

**Hiện trạng:** lõi phát đã tốt (vùng kích hoạt, ưu tiên khi chồng vùng, TTS dự phòng, lưu tiến độ). Vấn đề nằm ở lớp trình bày.

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Tour chưa cấu hình route thì `triggers` rỗng, nên chế độ GPS không tự phát điểm nào | Mặc định: vùng tròn 50 m quanh mỗi điểm + route theo thứ tự điểm (xem UC11) | 1 |
| 🟠 | Ảnh điểm dừng luôn vỡ: API trả `images: [{url, caption}]` nhưng [PlaceSheet.jsx:70](../../client/src/features/player/PlaceSheet.jsx#L70) dùng cả object làm `src` | `src={img.url}`, `alt={img.caption}` | 0 |
| 🟠 | Công cụ "Giả lập GPS (thử nghiệm)" hiện cho khách ở chế độ GPS ([TourPlayerPage.jsx:413](../../client/src/features/player/TourPlayerPage.jsx#L413)) | Chỉ hiện ở Xem thử (UC13) hoặc khi có `?debug=1` | 0 |
| 🟡 | Hộp thoại hoàn thành có chọn sao **giả** kèm dòng "(Gửi đánh giá sẽ có ở UC05.)" | Bỏ phần sao cho tới khi làm UC05; thay bằng "Khám phá tour khác" | 0 |
| 🟡 | Màn lỗi ghi "Về trang chủ" nhưng thực ra đi về `backTo` ([TourPlayerPage.jsx:263](../../client/src/features/player/TourPlayerPage.jsx#L263)); với UC13, `backTo` là trình chỉnh sửa | Nhãn nút theo đúng nơi đến | 0 |
| 🟡 | Chế độ GPS: sheet nội dung mở sẵn che gần hết bản đồ; không biết điểm tiếp theo còn bao xa | GPS: sheet thu gọn mặc định + thẻ "Tiếp theo: Chùa Cầu · 120 m" | 2 |
| ⚪ | Trình duyệt hỏi quyền vị trí ngay khi bấm, không có lời giải thích trước | Màn giải thích ngắn trước khi hỏi quyền; bị từ chối thì gợi ý chuyển sang Nghe thử | 2 |
| ⚪ | Tên điểm lặp 2 lần (tiêu đề sheet và tiêu đề trình phát) | Khi sheet mở, thanh phát chỉ hiện điều khiển | 4 |

### UC07: Tạo & quản lý lịch trình cá nhân

**Đặc tả:** Khám phá → chọn điểm → **xem chi tiết** → "Thêm vào lịch trình" → hệ thống **hỏi tên nếu chưa có lịch trình** → sắp xếp → xem trên bản đồ với khoảng cách và thời gian.
**Hiện trạng:** người dùng phải **tạo lịch trình trước** ở màn khác, quay lại Khám phá, **chọn lịch trình đích trong dropdown** ([ExplorePage.jsx:119](../../client/src/features/explore/ExplorePage.jsx#L119)) rồi mới bấm "Thêm". Quên chọn thì gặp lỗi "Hãy chọn lịch trình đích ở trên trước khi thêm."

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🟠 | Thứ tự thao tác ngược với đặc tả: bước 5 lẽ ra hỏi tên lịch trình **lúc thêm** | Nút "Thêm" mở bottom sheet gồm danh sách lịch trình + "＋ Lịch trình mới" (nhập tên tại chỗ). Chưa đăng nhập → đăng nhập xong quay về và **tự hoàn tất** thao tác thêm | 2 |
| 🟠 | Không xem được chi tiết địa điểm trước khi thêm (bước 3: mô tả, ảnh, audio) | Bấm thẻ → sheet chi tiết + nghe thử + "Thêm vào lịch trình" | 2 |
| 🟡 | "Tìm tour" và "Khám phá địa điểm" là 2 khu tách rời; khách không rõ chúng khác nhau thế nào | Một màn Khám phá có nút chuyển [Tour \| Địa điểm]; ở chi tiết tour, mỗi điểm có "＋ Lịch trình" | 2 |
| 🟡 | Khám phá chỉ có danh sách; đặc tả bước 2 yêu cầu bản đồ hoặc danh sách | Nút chuyển Danh sách ⇄ Bản đồ | 3 |
| 🟡 | Trong trình chỉnh sửa, bấm điểm chỉ tô sáng trên bản đồ, không nghe hay xem được nội dung | Bấm điểm → sheet nội dung | 3 |
| ⚪ | Nút back của Khám phá dùng `navigate(-1)`: mở trực tiếp bằng link thì bấm back là thoát khỏi app | Có tab bar; back có điểm về mặc định | 2 |
| ⚪ | Xoá dùng `window.confirm` | Dùng ConfirmDialog chung + toast "Hoàn tác" | 4 |

### UC08: Đi theo lịch trình

Dùng lại trình phát UC04 nên **nhận luôn mọi lỗi của UC04**, và sẽ tự hết khi UC04 được sửa. Riêng màn intro của trình phát có ích cho lịch trình (vì lịch trình không có màn chi tiết). Vì vậy tách phần chọn chế độ thành component `ModePicker` dùng chung: đặt ở thanh đáy của chi tiết tour và ở chân trình chỉnh sửa lịch trình.

### UC09: Quản lý tour của mình (Studio)

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Không có Gửi duyệt / Xuất bản (A3), nên tour mãi ở trạng thái Nháp | API `POST /mine/:id/publish` (+ `unpublish`) và nút **Xuất bản** cuối checklist | 1 |
| 🟠 | Trình chỉnh sửa là "hub" gồm 4 ô ngang hàng với form bên dưới ([TourEditorPage.jsx:17](../../client/src/features/studio/TourEditorPage.jsx#L17)): không cho biết đã xong gì, còn thiếu gì, nên làm gì tiếp | **Stepper/checklist**: Thông tin ✓ → Điểm dừng (3) ✓ → Vùng kích hoạt ✓ → Ngôn ngữ (tuỳ chọn) → Xem thử & Xuất bản | 3 |
| 🟠 | Danh sách "Tour của tôi" không cho biết tiến độ hay bước tiếp theo | Mỗi thẻ có tiến độ "3/4" + nút hành động tiếp theo ("Thêm điểm", "Xuất bản") | 3 |
| 🟠 | Ảnh bìa là ô dán URL (đặc tả yêu cầu upload) | Upload ảnh (cần API media, xem §7) | 3 |
| 🟡 | Ở 360px, tên tài khoản chiếm chỗ trên header nên tiêu đề bị cắt ("Vòn…", "Điể…"); phụ đề hiện "Mã tour: \<uuid\>" ([TourEditorPage.jsx:121](../../client/src/features/studio/TourEditorPage.jsx#L121)) | Header gọn (tài khoản chuyển vào tab Tài khoản); bỏ UUID | 0 / 2 |
| ⚪ | Các nút "Tạo tour", "Đăng nhập", "Xong" bị gạch chân vì `<Link className="btn">` không có `text-decoration: none` ([app.css:185](../../client/src/styles/app.css#L185)) | Sửa trong `.btn` | 0 |

### UC10: Thêm & quản lý địa điểm

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Ảnh và audio người thật chỉ nhận URL: tác giả thu âm bằng điện thoại không có cách nào đưa file lên | Upload file (nhiều ảnh, audio mp3/m4a). Phase sau: ghi âm trực tiếp trên trình duyệt (MediaRecorder) | 3 |
| 🟠 | Chọn vị trí: bấm "Chọn trên bản đồ" (nằm dưới nếp gấp), cuộn lên chạm bản đồ, rồi cuộn xuống tiếp; hoặc gõ tay lat/lng | **Bản đồ trước**: chạm bản đồ hoặc tìm địa chỉ → ghim kéo được → form trượt lên. Ô lat/lng ẩn trong "Nhập toạ độ thủ công" | 3 |
| 🟠 | Không tìm được theo địa chỉ, dù đây là luồng chính của đặc tả (bước 3) | Ô tìm địa chỉ (Nominatim, gọi qua proxy ở gateway) | 3 |
| 🟡 | Vùng cấm (E2) chỉ hiện thông báo chung, vì `errorHandler` dùng chung chỉ trả `{error}` | Trả thêm `code` + hình vùng cấm; client vẽ vùng và gợi ý dời ghim | 3 |
| 🟡 | Bấm Huỷ hoặc Back khi đang nhập: mất dữ liệu mà không cảnh báo | Chặn rời màn khi có thay đổi chưa lưu (dirty guard) | 3 |
| ⚪ | Gợi ý "(UC12)" lộ ra cho người dùng | Bỏ mã UC khỏi mọi chuỗi giao diện | 0 |

### UC11: Route & vùng kích hoạt

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Route mặc định rỗng: muốn Xem thử hay để khách đi GPS, tác giả phải biết bấm "Tạo theo thứ tự điểm dừng" **và** "Lưu cấu hình" | **Tự sinh mặc định** ở backend (`buildTourDetailView` / `PreviewTour`): không có cấu hình thì route = nối các điểm theo thứ tự, mỗi điểm có vùng tròn 50 m. Màn này trở thành "Tuỳ chỉnh nâng cao" | 1 |
| 🟠 | Nút "Xong" ngay cạnh "Lưu cấu hình" ([RouteConfigPage.jsx:367](../../client/src/features/studio/RouteConfigPage.jsx#L367)) thoát **mà không lưu**, cũng không cảnh báo | Bỏ "Xong"; có dirty guard; thanh Lưu dính đáy chỉ hiện khi có thay đổi | 3 |
| 🟡 | Trang dài ~2070px; mỗi điểm một khối gồm bán kính, ưu tiên (ô số trống trơn, không giải thích thang điểm) và gợi ý | Chọn điểm trên bản đồ → chỉnh trong sheet; vòng tròn trên bản đồ đổi theo khi kéo thanh trượt; ưu tiên chọn "Cao / Thường / Thấp" | 3 |
| 🟡 | Audio chỉ đường cũng nhập URL + lat/lng | Chạm bản đồ để đặt tâm; upload audio hoặc dùng TTS đọc từ chữ | 3 |
| ⚪ | Lộ chuỗi "(cần có để xem thử ở UC13)"; số thứ tự bắt đầu từ 0 | Như UC02 / UC10 | 0 |

### UC12: Đa ngôn ngữ & TTS

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🟠 | "English" thực chất vẫn là tiếng Việt: adapter `EchoTranslator` trả nguyên văn bản gốc, nên khách chọn English vẫn nghe tiếng Việt | Nối AI service (đã có Gemini/Groq client); trong lúc chờ, **không hiện** ngôn ngữ chưa có bản dịch thật cho khách | 1 |
| 🟡 | Mọi điểm × mọi ngôn ngữ trải thành textarea trên một trang | Tab theo ngôn ngữ; mỗi điểm 1 dòng gồm bản gốc (thu gọn) ↔ bản dịch, trạng thái "Máy dịch / Đã sửa", nút Nghe thử; đầu tab ghi "4/4 điểm đã dịch" | 3 |
| ⚪ | "Vùng miền" là ô nhập tự do | Danh sách chọn | 4 |

### UC13: Xem thử tour

| Mức | Vấn đề | Sửa | P |
|---|---|---|---|
| 🔴 | Thiếu route → màn lỗi chung "Đã có lỗi khi tải tour" với nút "Thử lại" (bấm vô ích) | Hết lỗi nhờ route tự sinh (UC11). Nếu vẫn thiếu (chưa có điểm nào) thì báo rõ và có nút "Thêm điểm dừng" | 0 / 1 |
| 🟠 | Mô phỏng GPS là việc chính khi xem thử nhưng bị giấu: nút tròn nổi → bật công tắc → "Đi theo route" | Ở chế độ xem thử, thanh mô phỏng hiện sẵn: ▶ Đi bộ mô phỏng · tốc độ · chạm bản đồ để dịch chuyển | 3 |
| 🟡 | Phát hiện lỗi nhưng không quay về đúng chỗ cần sửa (A2) | Trên sheet điểm có "Sửa điểm này" → mở Studio tại đúng điểm đó | 3 |

### UC chưa làm nhưng đang lộ ra giao diện

- **UC03 (offline):** nút "Tải để nghe offline (sắp có)" bị vô hiệu → ẩn đi.
- **UC05 (đánh giá):** chọn sao giả trong CompletionDialog → ẩn. Mục "Đánh giá & nhận xét" ở chi tiết tour chỉ giữ điểm trung bình.

---

## 3. Vấn đề xuyên suốt

1. **Không có khung điều hướng.** Có 7 kiểu header (`home__top`, `tours__top`, `itin__top`, `studio__top`, `auth__top`, `topbar`, `intro`). Muốn chuyển giữa Tour ↔ Lịch trình ↔ Studio chỉ có cách về trang chủ hoặc mở menu tài khoản.
2. **Nút sáng/tối có ở mọi header**, chiếm chỗ của hành động chính.
3. **Ngôn ngữ dev lộ ra giao diện:** "UC02/UC12/UC13", "Mã tour: \<uuid\>", "Mở nhanh bằng mã tour / Dán ID tour (UUID)", "(sắp có)", "TTS", "Giả lập GPS".
4. **Lỗi không chỉ ra cách sửa.** `errorHandler` của tour service chỉ trả `{ error }`, nên client không phân biệt được loại lỗi để dẫn người dùng đi sửa (vùng cấm, thiếu điểm, thiếu route…).
5. **Không chống mất dữ liệu:** rời form có thay đổi mà không cảnh báo; xác nhận bằng `window.confirm`.
6. **Desktop phí chỗ:** mọi màn là một cột hẹp ở giữa (ảnh chụp ở 1366px), bản đồ nhỏ.
7. **Link dạng nút bị gạch chân** (Đăng nhập, Tạo tour, Xong, các thẻ ở trang chủ).
8. **State không nằm trong URL** (bộ lọc, tab): reload hoặc back là mất.

---

## 4. Kiến trúc thông tin mới

### 4.1 App shell

```
Điện thoại (< 768px)                      Desktop (≥ 1024px)
┌──────────────────────────┐             ┌──────────────────────────────────────────────┐
│  Tiêu đề màn      [⋯]    │             │ ◉ GeoSound  Khám phá  Lịch trình  Studio  (L)│
│                          │             ├──────────────────────────────────────────────┤
│        nội dung          │             │  nội dung tối đa 1200px, 2 cột khi có bản đồ │
│                          │             │                                              │
├──────────────────────────┤             │                                              │
│ 🧭Khám phá 🗺Lịch trình  │             └──────────────────────────────────────────────┘
│ 🎙Studio*  👤Tài khoản   │   * chỉ hiện với contributor
└──────────────────────────┘
```

- **Thanh tab ẩn** ở các màn toàn màn hình: trình phát, chọn vị trí trên bản đồ, đăng nhập.
- **Nút sáng/tối chuyển vào Tài khoản** (mặc định theo hệ thống).
- Một component `AppHeader` duy nhất (tiêu đề + back có điểm về mặc định + tối đa 1 hành động bên phải), thay cho 7 kiểu header hiện tại.

### 4.2 Bản đồ route

| Hiện tại | Mới | Ghi chú |
|---|---|---|
| `/` (trang chủ trống) + `/tours` + `/explore` | `/` **Khám phá** (`?tab=tours\|places&q=&city=&lang=&type=&sort=`) | `/tours`, `/explore` chuyển hướng về `/` |
| `/tour/:id` | `/tour/:id` | thanh đáy: [Nghe thử] [Bắt đầu đi tour] |
| `/tour/:id/play` (+ màn intro) | `/tour/:id/play?mode=remote\|gps` | không còn intro; chỉ hỏi "Tiếp tục từ điểm 3?" khi có tiến độ dở |
| `/itineraries`, `/itineraries/:id`, `/itinerary/:id/go` | giữ nguyên, nằm dưới tab **Lịch trình** | |
| `/login` | `/login`, `/register`, `/forgot-password` | đăng ký có bước chọn vai trò |
| — | `/account` | hồ sơ, giao diện sáng/tối, đăng xuất |
| `/studio/tours/:id` (hub) + `/places` `/route` `/languages` `/preview` | `/studio/tours/:id/{info,places,zones,languages,publish}` dùng chung **StudioTourLayout** có stepper | `/preview` mở từ bước `publish` |

---

## 5. Thiết kế lại các luồng chính

### 5.1 Khám phá (UC02 + UC07 bước 1–3)

```
┌──────────────────────────────┐
│ Khám phá                     │
│ ┌──────────────────────────┐ │
│ │🔍 Tìm tour, địa điểm…    │ │
│ └──────────────────────────┘ │
│ [Tour] [Địa điểm]   ⚙Lọc(1) │  ← bộ lọc trong bottom sheet
│ Hội An · Hà Nội · Đà Nẵng…   │  ← chip thành phố (cuộn ngang)
│                              │
│ Gần bạn            Xem tất cả│  ← chỉ khi đã cấp vị trí; chưa cấp → thẻ "Bật vị trí"
│ [thẻ][thẻ][thẻ] →            │
│ Phổ biến                     │
│ ┌────────┐ Hội An về đêm     │
│ │ ảnh    │ 4 điểm · 75 phút  │
│ └────────┘ ★4,9 · Giọng máy  │
├──────────────────────────────┤
│ tab bar                      │
└──────────────────────────────┘
```

- Gõ chữ → hiện danh sách kết quả ngay (debounce). Toàn bộ state nằm trong URL.
- Tab **Địa điểm**: thẻ địa điểm → sheet chi tiết (ảnh, mô tả, nghe thử) → **＋ Lịch trình** (xem 5.3).

### 5.2 Chi tiết tour → Nghe (UC02 → UC04)

```
┌──────────────────────────────┐
│ ← (ảnh bìa)                  │
│ Hội An về đêm                │
│ Hội An · 4 điểm · 1 giờ 15p  │
│ ★4,9 (310) · Giọng đọc máy   │
│ Ngôn ngữ: [Tiếng Việt][Eng]  │  ← đưa lên trên, gần nút hành động
│ Mô tả…                       │
│ [ bản đồ route ]             │
│ Điểm dừng                    │
│ 1 Chùa Cầu        ▶  ＋      │  ← ▶ nghe thử điểm, ＋ thêm vào lịch trình
│ 2 Hội quán Phúc Kiến ▶ ＋    │
├──────────────────────────────┤
│ [🎧 Nghe thử]  [➤ Bắt đầu đi]│  ← dính đáy, luôn nhìn thấy
└──────────────────────────────┘
```

- "Bắt đầu đi" → màn giải thích quyền vị trí (1 lần) → trình phát `?mode=gps`. Bị từ chối → gợi ý "Nghe thử".
- Trong trình phát ở chế độ GPS: bản đồ chiếm phần lớn màn, có thẻ "Tiếp theo: X · 120 m"; sheet nội dung tự mở khi vào vùng kích hoạt.

### 5.3 Thêm vào lịch trình (UC07)

```
Bấm ＋ (ở địa điểm hoặc ở điểm dừng của tour)
  ├─ chưa đăng nhập → /login?next=…&intent=add:<placeId> → đăng nhập xong tự thêm, hiện toast
  └─ đã đăng nhập → bottom sheet:
        Thêm "Chùa Cầu" vào…
        ○ Hội An 1 ngày (3 điểm)
        ○ Cuối tuần Đà Nẵng (5 điểm)
        ＋ Lịch trình mới: [ tên… ] [Tạo & thêm]
     → toast "Đã thêm vào Hội An 1 ngày · Xem"
```

### 5.4 Đăng ký (UC01)

```
Bước 1  Bạn dùng GeoSound để…   [🧳 Đi du lịch]  [🎙 Tạo tour audio]
Bước 2  Họ tên · Email · Mật khẩu (👁)            [Tiếp tục]
Bước 3  OTP 6 số · còn 1:42 · Gửi lại (sau 30s)   [Xác thực]
→ Tourist về trang trước / Khám phá · Contributor về Studio (gợi ý "Tạo tour đầu tiên")
```

### 5.5 Studio: từ tạo tour đến xuất bản (UC09 → UC13)

```
┌──────────────────────────────┐
│ ← Vòng quanh Hồ Gươm  [Nháp] │
│ ①Thông tin ✓ ②Điểm(3) ✓      │  ← stepper cuộn ngang, ✓ / ! theo dữ liệu thật
│ ③Vùng KH ✓ ④Ngôn ngữ ⑤Xuất bản│
├──────────────────────────────┤
│ Sẵn sàng xuất bản?           │
│ ✓ Có tên, ngôn ngữ gốc       │
│ ✓ Ít nhất 1 điểm có mô tả    │
│ ✓ Route & vùng kích hoạt     │  ← tự sinh, "Tuỳ chỉnh" để sửa
│ ! Chưa có ảnh bìa (khuyến nghị)│
│ [▶ Xem thử như khách]        │
│ [ Xuất bản ]                 │  ← bật khi các mục bắt buộc đã ✓
└──────────────────────────────┘
```

- **Tạo tour** chỉ hỏi tên + ngôn ngữ gốc + thành phố, rồi vào thẳng bước **Điểm dừng**.
- **Điểm dừng:** bản đồ toàn màn → tìm địa chỉ hoặc chạm để thả ghim (kéo được) → sheet form: tên, loại, mô tả, ảnh (upload), audio (upload hoặc "Dùng giọng đọc máy").
- **Vùng kích hoạt:** đã có sẵn mặc định; màn này để tuỳ chỉnh bán kính, ưu tiên, gợi ý đi tiếp, audio chỉ đường.
- **Xuất bản:** gọi `POST /mine/:id/publish`. Sửa tour đang công khai thì hỏi "Tour sẽ về Nháp, cần xuất bản lại", đúng hành vi A1 hiện có.

---

## 6. Lộ trình triển khai

Đặt tên branch theo tính năng ([quy ước của repo](../00-init/conventions.md)), mỗi branch một PR vào `develop`.
Ước lượng: **S** ≤ 1 ngày · **M** 2–3 ngày · **L** 4–5 ngày.

### Phase 0: Sửa nhanh, gỡ lỗi ai cũng thấy (S–M, làm ngay)

Branch `feature/ux-quick-fixes`, chỉ sửa client:

- [ ] `.btn` thêm `text-decoration: none`
- [ ] PlaceSheet: `src={img.url}`, `alt={img.caption}`
- [ ] Map `voiceLabel` (`human`/`tts`) → nhãn tiếng Việt ở một chỗ duy nhất
- [ ] Số thứ tự điểm dùng `index + 1` (chi tiết, ghim bản đồ, trình phát, Studio)
- [ ] Gỡ mọi mã UC, UUID và "Mở nhanh bằng mã tour" khỏi giao diện (chỉ giữ khi `import.meta.env.DEV`)
- [ ] Ẩn SimControls với khách; ẩn nút offline "sắp có"; ẩn chọn sao giả
- [ ] Màn lỗi của trình phát: nhãn nút theo đích; lỗi xem thử 422 dẫn tới bước còn thiếu
- [ ] Header Studio ở mobile: chỉ hiện avatar, tiêu đề không bị cắt

**Nghiệm thu:** chạy lại toàn bộ luồng ở 360px: không còn chữ `tts`, số 0, gạch chân, mã UC; ảnh điểm dừng hiện đúng.

### Phase 1: Nối lại các vòng đời bị đứt (M, cần backend)

| Branch | Nội dung | Nghiệm thu |
|---|---|---|
| `feature/tour-publish` | Use-case `PublishTour` / `UnpublishTour` (kiểm tra sẵn sàng: có điểm, có mô tả), endpoint `POST /mine/:id/publish\|unpublish`, nút trên client | Contributor mới tạo tour → xuất bản → tìm thấy tour ở Khám phá |
| `feature/default-route-zones` | Không có `RouteConfig` → `buildTourDetailView` và `PreviewTour` tự sinh route theo thứ tự điểm + vùng tròn 50 m | Tour chỉ có điểm vẫn xem thử được và tự phát ở chế độ GPS |
| `feature/contributor-signup` | Chọn vai trò khi đăng ký, quên mật khẩu, điều hướng theo vai trò sau đăng nhập | Người lạ tự đăng ký làm contributor và vào được Studio |
| `feature/real-translation` | Thay `EchoTranslator` bằng adapter gọi AI service; ngôn ngữ chưa có bản dịch thật thì không hiện cho khách | Chọn English thì nghe và đọc tiếng Anh |

### Phase 2: App shell + luồng khách (L)

| Branch | Nội dung |
|---|---|
| `feature/app-shell` | `AppLayout` + tab bar theo vai trò, `AppHeader` dùng chung, `/account`, chuyển nút sáng/tối vào Tài khoản, layout desktop rộng |
| `feature/discover-home` | Gộp Home + Tours + Explore; bộ lọc trong bottom sheet; state trong URL; mục Gần bạn / Phổ biến |
| `feature/tour-detail-actions` | Thanh đáy [Nghe thử] [Bắt đầu đi]; `ModePicker` dùng chung; trình phát nhận `?mode=`; bỏ màn intro; bấm điểm để nghe thử; giải thích quyền GPS; thẻ "Tiếp theo · khoảng cách" |
| `feature/itinerary-quick-add` | Sheet "Thêm vào…" + tạo lịch trình tại chỗ; `intent` sống qua bước đăng nhập; sheet chi tiết địa điểm |

**Nghiệm thu:** bài test §9, nhiệm vụ T1–T2, mỗi nhiệm vụ ≤ 60 giây và không cần hướng dẫn.

### Phase 3: Studio thành quy trình tạo nội dung (L)

| Branch | Nội dung |
|---|---|
| `feature/media-upload` | Backend: `POST /api/media/uploads` (multipart → Supabase Storage), trả URL; client: component `FileDrop` cho ảnh bìa, ảnh điểm, audio |
| `feature/studio-stepper` | `StudioTourLayout` + stepper + checklist sẵn sàng; thẻ danh sách có tiến độ và nút hành động tiếp theo; dirty guard dùng chung |
| `feature/place-editor-map-first` | Bản đồ toàn màn, tìm địa chỉ (proxy Nominatim), ghim kéo được, form dạng sheet; vẽ vùng cấm khi lỗi E2 |
| `feature/zones-editor` | Chỉnh vùng ngay trên bản đồ, ưu tiên Cao/Thường/Thấp, thanh lưu dính đáy |
| `feature/preview-sim-bar` | Thanh mô phỏng hiện sẵn trong xem thử, nút "Sửa điểm này" |

**Nghiệm thu:** nhiệm vụ T3 trong §9 hoàn thành không cần hướng dẫn, trong ≤ 10 phút.

### Phase 4: Hoàn thiện

ConfirmDialog + toast "Hoàn tác" thay `window.confirm`; trang ngôn ngữ chia tab; khám phá dạng bản đồ; ghi âm trực tiếp; rà soát a11y (focus, aria cho sheet, độ tương phản dark mode).

---

## 7. Backend cần bổ sung

| Hạng mục | Service | Ghi chú |
|---|---|---|
| Publish / unpublish tour | tour | Use-case mới; tái dùng điều kiện `missing` của `PreviewTour` làm kiểm tra sẵn sàng |
| Route + vùng mặc định | tour | Fallback trong `buildTourDetailView` khi chưa có cấu hình; không cần migration |
| Lỗi có `code` + `details` | shared `errorHandler` | Để client dẫn người dùng tới đúng chỗ cần sửa (vùng cấm, thiếu điểm…) |
| Upload media | media (đang là khung rỗng) | Multipart → Supabase Storage; giới hạn loại và dung lượng; trả URL công khai |
| Proxy geocoding | gateway | `GET /api/geocode?q=` → Nominatim, có cache + User-Agent theo điều khoản sử dụng |
| Dịch thật | tour → ai | Adapter `Translator` gọi AI service thay `EchoTranslator` |

---

## 8. Quyết định cần chốt

| # | Câu hỏi | Đề xuất | Lý do |
|---|---|---|---|
| D1 | Contributor **xuất bản thẳng** hay "Gửi duyệt" (đang bỏ qua kiểm duyệt)? | Xuất bản thẳng, có checklist; sau này cắm UC15 vào giữa | Đúng phạm vi hiện tại; không để nút chết |
| D2 | Ai được làm contributor? | Tự chọn khi đăng ký | Đặc tả A1.2 và backend đều đã hỗ trợ; chưa có UI admin |
| D3 | Lưu media ở đâu? | Supabase Storage | DB đã ở Supabase; không phải dựng S3 |
| D4 | Khách chưa đăng nhập có lưu lịch trình được không? | Không; chỉ hỏi đăng nhập **đúng lúc lưu** rồi tự hoàn tất thao tác | Giữ precondition của UC07, bớt ma sát |
| D5 | Contributor có thấy giao diện của khách không? | Có: 4 tab, Studio là một tab | Tác giả cũng nghe và kiểm tra tour như khách |

---

## 9. Kiểm chứng

**Kiểm thử tự động:** sau mỗi phase, chạy lại kịch bản Playwright ở 360×732 và 1366×768 (đăng nhập → tìm → chi tiết → nghe thử → thêm vào lịch trình → Studio tạo → xuất bản), chụp màn hình so sánh trước/sau.

**Kiểm thử với người dùng** (3–5 bạn chưa từng dùng app; ghi thời gian, số lần hỏi, chỗ bỏ cuộc):

| # | Nhiệm vụ | Đạt khi |
|---|---|---|
| T1 | "Bạn sắp đi Hội An, tìm một tour và nghe thử điểm thứ 2" | ≤ 60 s, không hỏi |
| T2 | "Lập lịch trình gồm 3 địa điểm ở Hội An rồi bắt đầu đi theo nó" | ≤ 3 phút |
| T3 | "Đăng ký làm tác giả, tạo tour 2 điểm, xem thử rồi xuất bản; tìm thấy tour vừa tạo" | ≤ 10 phút |
| T4 | "Đổi sang nghe bằng tiếng Anh" | ≤ 20 s, nội dung là tiếng Anh thật |

Hiện tại T3 **không thể hoàn thành** (do D1/D2), T1 mất nhiều bước vì trang chủ trống và có 2 màn intro, T4 cho ra nội dung tiếng Việt.
