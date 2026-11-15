# Checklist kiểm tra frontend GeoSound theo 22 use case

Ngày đối chiếu: 28/10/2026. Phạm vi: `develop` tại `1eff05e`, [TRACEABILITY.md](TRACEABILITY.md), dữ liệu route frontend và các issue GitHub đang mở. Đây là danh sách để bạn kiểm tra, không phải chứng nhận mọi chức năng đã hoàn thành. Task checklist: [#224](https://github.com/Tran-Gia-Phuc/GeoSound/issues/224).

Bản sửa lỗi Khám phá nằm ở [PR #225](https://github.com/Tran-Gia-Phuc/GeoSound/pull/225), commit `ced43ac`, chưa merge tại lúc viết checklist. Bản xem trước cục bộ: [http://localhost:5176](http://localhost:5176) khi Vite đang chạy; `develop` chưa chứa bản sửa cho đến khi PR được merge.

Nguồn `TRACEABILITY.md`/`TRACEABILITY.csv` và bộ ảnh A đang có trong workspace cục bộ, chưa được Git theo dõi. Checklist mới giữ đầy đủ nội dung 464 mục để có thể đọc độc lập; việc đưa bộ nguồn thiết kế lên Git cần một task riêng, không gộp vào sửa lỗi frontend.

- `[ ]` là ô để **người kiểm tra** đánh dấu sau khi đã thử và thấy đạt; chưa có ô nào được đánh dấu sẵn.
- **Có thể thử**: có giao diện/luồng tương ứng trong code, nhưng từng bước vẫn phải kiểm tra với dữ liệu thật. Không có nghĩa toàn bộ UC đã hoàn tất.
- **Một phần / cần kiểm tra**: có một số thành phần, còn giới hạn hoặc chưa xác minh end-to-end.
- **Dự kiến**: chưa đủ frontend, backend hoặc tích hợp; chưa có lịch hoàn thành. Không đánh dấu đạt chỉ vì có ảnh thiết kế hoặc dữ liệu mẫu.
- Chữ **Dự kiến** trong danh mục từng yêu cầu là phân loại theo mức UC để hỗ trợ lập kế hoạch, không phải kết luận rằng từng dòng chưa có bất kỳ thành phần nào. Với các mục còn lại, trạng thái là **cần kiểm tra từng dòng**, không mặc định đã hoàn thành.

Mở ứng dụng ở [http://localhost:5173](http://localhost:5173) khi Vite đang chạy. Lịch trình cần tài khoản; Studio cần tài khoản Contributor và dữ liệu thuộc tài khoản. Theo ảnh trao đổi, nhóm trưởng nhận xử lý email và S3; đây là phụ thuộc cần phối hợp kiểm tra, chưa phải ngày hẹn hoàn thành. Việc upload, tạo/sửa/xóa tour hoặc lịch trình là ghi dữ liệu thật: dùng dữ liệu test được nhóm cho phép.

## UC01 — Tài khoản: một phần / cần kiểm tra

Trang: `/login`, `/register`, `/forgot-password`, `/account`. Hiện form và backend dùng **email**; yêu cầu SĐT trong đặc tả chưa được xác nhận hỗ trợ.

- [ ] Đăng nhập bằng email/mật khẩu đúng; kiểm tra chuyển trang theo quyền Tourist hoặc Contributor và đăng xuất.
- [ ] Bỏ trống hoặc nhập sai mật khẩu; kiểm tra thông báo và có thể thử lại.
- [ ] Kiểm tra giao diện tài khoản bị khóa/ban nếu có tài khoản test và backend trả trạng thái tương ứng; không tự khóa tài khoản thật.
- [ ] Đăng ký Tourist và Contributor, kiểm tra bắt buộc, email, mật khẩu tối thiểu 8 ký tự có chữ và số, xác nhận mật khẩu.
- [ ] **Dự kiến / chờ email**: gửi, nhập sai/hết hạn và gửi lại OTP; xác minh sau đăng ký không tự tạo phiên; sau đó đăng nhập và kiểm tra role. Backend chỉ gửi lại khi challenge còn tồn tại; cần làm rõ trường hợp challenge đã hết hạn.
- [ ] **Dự kiến / chờ email**: quên mật khẩu, nhận OTP, đặt mật khẩu mới, kiểm tra mật khẩu mới và cũ trên tài khoản test.
- [ ] Kiểm tra chế độ khách, mục tài khoản và chuyển sáng/tối nếu thiết bị hỗ trợ.

## UC02 — Tìm và xem tour: có thể thử

Trang: `/`, sau đó mở chi tiết tour. Ảnh mẫu có thể là ảnh Picsum không khớp địa điểm.

- [ ] Tìm theo từ khóa; chọn thành phố, loại, ngôn ngữ và các bộ lọc có thật; xóa lọc để xem lại danh sách.
- [ ] Kiểm tra danh sách rỗng, lỗi mạng và nút thử lại khi có điều kiện tái hiện.
- [ ] Sau khi dùng bản sửa [#223](https://github.com/Tran-Gia-Phuc/GeoSound/issues/223), chuyển Tour ↔ Địa điểm khi đang lọc, đang tải và đang “Xem thêm”; thử dạng danh sách/bản đồ, link `?addTo=...&city=Hội+An`, tải lại và quay lại bằng trình duyệt. Không xuất hiện lỗi `.length`/`.map`, không hiện kết quả của tab trước. Xem [ma trận trace lỗi](ERROR-TRACE-DISCOVERY.md).
- [ ] Mở tour: kiểm tra tên, mô tả, ảnh, điểm dừng, route, thời lượng và nhãn giọng theo dữ liệu trả về.
- [ ] Đổi ngôn ngữ; khi đổi thất bại, kiểm tra thông báo và dữ liệu trước đó còn hiển thị.
- [ ] Mở trình nghe từ xa hoặc chọn bắt đầu theo vị trí. **Dự kiến**: tải offline và tạo báo cáo theo UC03/UC06.

## UC03 — Tour offline: dự kiến

Chưa có đủ hợp đồng gói tải, dung lượng và audio TTS dựng sẵn; PWA cache không chứng minh tour nghe được offline. Task [#103](https://github.com/Tran-Gia-Phuc/GeoSound/issues/103), [#104](https://github.com/Tran-Gia-Phuc/GeoSound/issues/104), [#158](https://github.com/Tran-Gia-Phuc/GeoSound/issues/158).

- [ ] **Dự kiến**: chọn ngôn ngữ và tải toàn bộ tài nguyên, xem tiến độ và đánh dấu tải xong.
- [ ] **Dự kiến**: tạm dừng, tiếp tục, hủy, phục hồi khi mất mạng hoặc không đủ dung lượng.
- [ ] **Dự kiến**: xem thư viện offline, dung lượng, thêm/xóa ngôn ngữ, xóa tour và nghe khi mất mạng.

## UC04 — Nghe tour: một phần / cần kiểm tra

- [ ] Từ chi tiết tour, chọn nghe thử; chọn điểm dừng và xem nội dung, ảnh và vị trí.
- [ ] Chọn bắt đầu theo GPS; hộp giải thích nằm trong màn hình, có thể đóng hoặc chọn “Cho phép & bắt đầu”. Kiểm tra cấp/từ chối quyền vị trí trên thiết bị thật.
- [ ] Thử phát, dừng, tiếp tục, tua 15 giây và chuyển điểm; kiểm tra không tua quá đầu/cuối và không phát chồng.
- [ ] Kiểm tra giọng TTS dự phòng khi không có audio, thay đổi ngôn ngữ và kết thúc tour.
- [ ] **Cần kiểm tra thêm**: audio lỗi giữa chừng, thử lại giữ tiến độ với file có thể tua; đổi điểm khi đang retry; Safari/mobile thực.
- [ ] **Dự kiến**: nghe offline đầy đủ phụ thuộc UC03.

## UC05 — Đánh giá và nhận xét: dự kiến

Điểm tổng quan có thể hiển thị trong chi tiết tour; chưa xác nhận có tạo/sửa/xóa đánh giá thật. Task [#105](https://github.com/Tran-Gia-Phuc/GeoSound/issues/105), [#162](https://github.com/Tran-Gia-Phuc/GeoSound/issues/162), [#163](https://github.com/Tran-Gia-Phuc/GeoSound/issues/163).

- [ ] **Dự kiến**: chọn sao, nhập nhận xét, kiểm tra bắt buộc và gửi qua API thật.
- [ ] **Dự kiến**: sửa/xóa đánh giá của mình, bảo toàn bản nháp khi lỗi và cập nhật điểm tổng hợp.

## UC06 — Báo cáo tour: dự kiến

Task [#106](https://github.com/Tran-Gia-Phuc/GeoSound/issues/106), [#164](https://github.com/Tran-Gia-Phuc/GeoSound/issues/164), [#165](https://github.com/Tran-Gia-Phuc/GeoSound/issues/165).

- [ ] **Dự kiến**: chọn lý do, nhập chi tiết khi chọn “Khác”, gửi báo cáo và xử lý báo cáo trùng/lỗi API.
- [ ] **Dự kiến**: theo dõi kết quả báo cáo khi có API và giao diện tương ứng.

## UC07 — Lịch trình cá nhân: một phần / cần kiểm tra

Trang `/itineraries`; mở tab địa điểm trên Khám phá để thêm điểm.

- [ ] Đăng nhập, tạo lịch trình, thêm địa điểm và mở danh sách của mình.
- [ ] Đổi tên, tải lại trang để kiểm tra dữ liệu còn lưu; thử tên rỗng và lỗi mạng.
- [ ] Mở trình chỉnh sửa, sắp xếp/xóa điểm; kiểm tra khoảng cách, thứ tự và nội dung sau tải lại.
- [ ] Từ trình chỉnh sửa → thêm địa điểm → đổi tab/lọc/xem bản đồ → thêm điểm → “Xong”; ngữ cảnh lịch trình và thành phố được giữ. Kiểm tra thông báo khi lịch trình đã xóa, không thuộc mình hoặc phiên đăng nhập hết hạn; không coi lỗi tìm kiếm là thêm thành công.
- [ ] Chia sẻ hoặc tắt chia sẻ; mở liên kết chia sẻ trong cửa sổ khách và kiểm tra quyền.
- [ ] Kiểm tra trạng thái danh sách trống, lỗi/tải lại và đổi tài khoản không lộ lịch trình người trước.
- [ ] **Cần kiểm tra thêm**: chống lưu trùng khi bấm liên tục và không mất nội dung khi API lỗi với dữ liệu test thật.

## UC08 — Đi theo lịch trình: một phần / cần kiểm tra

- [ ] Từ lịch trình của mình hoặc liên kết chia sẻ, mở nghe thử từng điểm.
- [ ] Kiểm tra route, tên điểm, chuyển điểm, điều khiển âm thanh và hoàn tất.
- [ ] Kiểm tra chế độ GPS, mất/quyền vị trí, lỗi audio và rời trang trên thiết bị thật.
- [ ] **Dự kiến**: đi offline phụ thuộc UC03.

## UC09 — Quản lý tour của Contributor: một phần / cần kiểm tra

Trang `/studio`, `/studio/tours/new` và trang chỉnh sửa tour.

- [ ] Đăng nhập Contributor; xem danh sách tour của mình, trạng thái, tìm kiếm và lọc.
- [ ] Tạo tour nháp bằng hai lựa chọn lưu/tiếp tục; kiểm tra bắt buộc, dữ liệu còn sau tải lại và không tạo trùng khi bấm liên tục.
- [ ] Sửa thông tin và xóa tour test; kiểm tra xác nhận, quyền sở hữu và xử lý lỗi.
- [ ] Kiểm tra hiển thị ảnh bìa, ngôn ngữ, thời lượng, thành phố và mô tả đã lưu.
- [ ] **Dự kiến / chờ S3**: kiểm tra tải ảnh thật, lưu và mở lại trên môi trường nhóm xác nhận.
- [ ] Lưu ý: nút xuất bản trực tiếp hiện có không đồng nghĩa quy trình gửi AI/Admin duyệt ở UC15.

## UC10 — Quản lý điểm dừng: một phần / cần kiểm tra

Trong Studio → tour → Điểm dừng.

- [ ] Thêm/sửa/xóa/sắp xếp điểm test, tên, mô tả và vị trí; tải lại kiểm tra kết quả.
- [ ] Kiểm tra validate vị trí, quyền tác giả và lỗi địa điểm/vùng cấm nếu có dữ liệu test an toàn.
- [ ] Kiểm tra thu âm/đính kèm audio và nghe lại nếu môi trường có hỗ trợ.
- [ ] **Dự kiến / chờ S3**: upload và mở lại ảnh/audio thật; **dự kiến** kiểm duyệt ảnh [#137](https://github.com/Tran-Gia-Phuc/GeoSound/issues/137).

## UC11 — Route và vùng kích hoạt: một phần / cần kiểm tra

Trong Studio → tour → Route/vùng kích hoạt.

- [ ] Xem, chỉnh và lưu đường đi, thứ tự điểm và các vùng kích hoạt được hỗ trợ; tải lại kiểm tra.
- [ ] Kiểm tra vị trí/vùng không hợp lệ, lỗi API và không làm mất phần đang sửa.
- [ ] Kiểm tra kích hoạt khi di chuyển hoặc mô phỏng trên thiết bị/test data phù hợp.

## UC12 — Ngôn ngữ và giọng đọc: một phần / cần kiểm tra

Trong Studio → tour → Ngôn ngữ.

- [ ] Chọn ngôn ngữ phụ, giọng và lưu; kiểm tra tình trạng dịch của từng điểm.
- [ ] Sửa, lưu bản dịch; nghe thử bản đã lưu và kiểm tra không mất bản đang sửa khi lỗi.
- [ ] Chuyển hàng/ngôn ngữ khi preview đang tải; kiểm tra không phát chồng hoặc giữ trạng thái tải sai.
- [ ] **Dự kiến**: file TTS dựng sẵn để tải offline; hiện có đường dẫn placeholder và giọng đọc trên thiết bị, không nên xem là đã có file offline.

## UC13 — Xem thử tour: một phần / cần kiểm tra

- [ ] Mở preview của tour mình sở hữu; nghe từng điểm và thử chế độ mô phỏng đường đi.
- [ ] Kiểm tra quay về trang chỉnh sửa, nội dung/ngôn ngữ và thông báo khi tour chưa có điểm.
- [ ] Kiểm tra quyền Contributor và lỗi tải preview với dữ liệu test.

## UC14 — Passcode / truy cập hạn chế: dự kiến

Task [#107](https://github.com/Tran-Gia-Phuc/GeoSound/issues/107), [#108](https://github.com/Tran-Gia-Phuc/GeoSound/issues/108).

- [ ] **Dự kiến**: chủ tour tạo/đổi/tắt passcode; người được mời nhập mã và xem tour.
- [ ] **Dự kiến**: mã sai/hết hạn, kiểm soát quyền và bảo vệ dữ liệu tour.

## UC15 — Gửi tour đi duyệt AI: dự kiến

Task [#109](https://github.com/Tran-Gia-Phuc/GeoSound/issues/109), [#110](https://github.com/Tran-Gia-Phuc/GeoSound/issues/110), [#111](https://github.com/Tran-Gia-Phuc/GeoSound/issues/111), [#112](https://github.com/Tran-Gia-Phuc/GeoSound/issues/112), [#113](https://github.com/Tran-Gia-Phuc/GeoSound/issues/113), [#114](https://github.com/Tran-Gia-Phuc/GeoSound/issues/114). Moderation đã có consumer xử lý tour/địa điểm, AI và retry trong code; phần nối Tour đang ở [PR #213](https://github.com/Tran-Gia-Phuc/GeoSound/pull/213), chưa merge tại lúc đối chiếu. `develop` còn TODO phát `tour.submitted`, frontend chưa có trang gửi duyệt hoặc lấy kết quả duyệt. Cần hợp đồng API, tích hợp event và môi trường chạy đủ dịch vụ trước khi thử end-to-end; xem `docs/02-design/ai-integration-requests.md`.

- [ ] **Dự kiến**: checklist bắt buộc, gửi duyệt và theo dõi kết quả job.
- [ ] **Dự kiến**: kết quả đạt, cảnh báo, từ chối về nháp, chi tiết vùng cấm và xử lý chậm.
- [ ] **Dự kiến**: chuyển tiếp đúng sang hàng chờ Admin; không coi xuất bản trực tiếp hiện có là đã duyệt AI/Admin.

## UC16 — Thông báo và lịch sử duyệt: dự kiến

- [ ] **Dự kiến**: hộp thông báo, đọc/chưa đọc và mở chi tiết. [#115](https://github.com/Tran-Gia-Phuc/GeoSound/issues/115)
- [ ] **Dự kiến**: lịch sử duyệt, trạng thái, thời điểm, lý do và điểm liên quan. [#116](https://github.com/Tran-Gia-Phuc/GeoSound/issues/116)
- [ ] **Dự kiến / chờ email**: xác nhận thông báo email được gửi và nhận thật.

## UC17 — Thống kê tác giả: dự kiến

- [ ] **Dự kiến**: lượt xem/nghe/tải, hoàn tất, bộ lọc thời gian/ngôn ngữ và phân bố đánh giá theo API thật. [#117](https://github.com/Tran-Gia-Phuc/GeoSound/issues/117)

## UC18 — Trang tác giả: dự kiến

- [ ] **Dự kiến**: xem hồ sơ tác giả công khai và tour của tác giả. [#118](https://github.com/Tran-Gia-Phuc/GeoSound/issues/118)
- [ ] **Dự kiến**: sửa hồ sơ, ảnh/bio, theo dõi và bỏ theo dõi. [#119](https://github.com/Tran-Gia-Phuc/GeoSound/issues/119), [#120](https://github.com/Tran-Gia-Phuc/GeoSound/issues/120)

## UC19 — Admin duyệt tour: dự kiến

- [ ] **Dự kiến**: dashboard/hàng chờ, tìm/lọc, hồ sơ duyệt và preview chỉ đọc. [#121](https://github.com/Tran-Gia-Phuc/GeoSound/issues/121), [#122](https://github.com/Tran-Gia-Phuc/GeoSound/issues/122), [#123](https://github.com/Tran-Gia-Phuc/GeoSound/issues/123)
- [ ] **Dự kiến**: duyệt, từ chối có lý do, yêu cầu sửa và kiểm tra quyền Admin. [#124](https://github.com/Tran-Gia-Phuc/GeoSound/issues/124), [#125](https://github.com/Tran-Gia-Phuc/GeoSound/issues/125), [#126](https://github.com/Tran-Gia-Phuc/GeoSound/issues/126)

## UC20 — Admin xử lý báo cáo: dự kiến

- [ ] **Dự kiến**: hàng chờ, chi tiết báo cáo, ẩn/khôi phục tour, bỏ qua báo cáo và lưu lý do. [#127](https://github.com/Tran-Gia-Phuc/GeoSound/issues/127)–[#130](https://github.com/Tran-Gia-Phuc/GeoSound/issues/130)

## UC21 — Admin quản lý tài khoản vi phạm: dự kiến

- [ ] **Dự kiến**: tìm tài khoản, xem vi phạm, cảnh báo, khóa tạm thời, ban và khôi phục theo quyền và lý do. [#131](https://github.com/Tran-Gia-Phuc/GeoSound/issues/131)–[#135](https://github.com/Tran-Gia-Phuc/GeoSound/issues/135)

## UC22 — Dashboard và nhật ký Admin: dự kiến

- [ ] **Dự kiến**: xem dashboard số liệu, bộ lọc và dữ liệu tổng hợp thực. [#121](https://github.com/Tran-Gia-Phuc/GeoSound/issues/121)
- [ ] **Dự kiến**: xem/tìm/lọc nhật ký hành động và chi tiết, kiểm tra tính bất biến và quyền xem. [#136](https://github.com/Tran-Gia-Phuc/GeoSound/issues/136)

## Kiểm tra chung

- [ ] Thử các trang đã có ở desktop và điện thoại; nội dung không bị che, tràn ngang hoặc không thể bấm.
- [ ] Thử bàn phím Tab, Enter, Escape, đóng hộp thoại và trở lại nút đã mở.
- [ ] Kiểm tra trạng thái đang tải, rỗng, lỗi mạng và thử lại ở các trang có hỗ trợ.
- [ ] Với danh sách từ API: thử 200 trả danh sách rỗng hợp lệ, thiếu trường danh sách, `null`, sai kiểu, phần tử `null`, thiếu metadata và lỗi phân trang. Chỉ đánh dấu đạt cho các trang thực sự có test/kiểm tra; các điểm ngoài Khám phá còn cần kiểm tra hợp đồng riêng trong [trace lỗi](ERROR-TRACE-DISCOVERY.md).
- [ ] Kiểm tra phân quyền khách/Tourist/Contributor/Admin và các route yêu cầu đăng nhập.
- [ ] Ghi lại trình duyệt, màn hình, tài khoản/vai trò test, bước thực hiện và kết quả khi gặp lỗi; không ghi mật khẩu hoặc OTP vào báo cáo.

## Phụ thuộc và cách ghi kết quả

| Phần còn dự kiến | Phụ thuộc để có thể hoàn thiện |
| --- | --- |
| Xác minh email/đặt lại mật khẩu | Nhóm trưởng xử lý email; kiểm tra gửi/nhận OTP thật và expiry/resend |
| Lưu ảnh/audio | Nhóm trưởng xử lý S3; kiểm tra upload, quyền URL và mở lại sau lưu |
| Offline | Hợp đồng gói tải, audio có thể tải, dung lượng và lưu trữ thiết bị; các task UC03 |
| Đánh giá/báo cáo/passcode | API nghiệp vụ và frontend tương ứng, quyền và dữ liệu test; các task UC05/06/14 |
| Gửi duyệt/ảnh AI | Tích hợp Tour ↔ Moderation (#180 / PR #213), API đọc trạng thái/chi tiết và trang gửi duyệt/ảnh (#109–#114, #137) |
| Thông báo/thống kê/tác giả/Admin | API đọc/ghi theo quyền và các trang chưa có trong router; các task UC16–22 |
| Chatbot mới trong backend | Chưa thuộc 22 UC trong nguồn hiện tại; chưa có route giao diện và gateway chat, còn #188/#219. Chỉ đưa vào checklist nghiệm thu khi nhóm chốt yêu cầu và tích hợp |

Không có đủ bằng chứng để hẹn một ngày hoàn thiện toàn bộ frontend. Chỉ email/S3 là hai phần nhóm trưởng nhận làm sau theo ảnh; các phần khác là phụ thuộc kỹ thuật hoặc task chưa triển khai, không tự gán là chỉ đạo hoãn của nhóm trưởng.

Mỗi lần thử, ghi một dòng theo mẫu dưới; giữ ô trace chưa đánh dấu nếu chỉ test fixture, mới có ảnh hoặc chưa đủ điều kiện:

| Mã UC/trace hoặc mã lỗi | URL / thao tác | Kết quả mong đợi | Kết quả thực tế | Đạt / Lỗi / Dự kiến | Trình duyệt / commit / bằng chứng |
| --- | --- | --- | --- | --- | --- |
| Ví dụ: UC02 / D01 | Địa điểm → Tour với thành phố và addTo | Đổi kết quả đúng tab, không crash | Điền sau khi thử | Chưa kiểm tra | Điền môi trường test |

## Danh mục đầy đủ từng mục trace

464 mục dưới đây được lấy từ `TRACEABILITY.csv`, bao gồm cả bước, nhánh, lỗi, quy tắc, điều kiện trước/sau và giả định. Một số mục là quy tắc hoặc điều kiện backend nên cần dữ liệu/môi trường phù hợp, không nhất thiết có một nút riêng trên giao diện. Mỗi ô để trống để bạn tự đánh dấu sau khi kiểm tra; các mục thuộc UC dự kiến được gắn nhãn dự kiến theo mức UC.

Đã đối chiếu tự động: 464/464 ID, 22 UC, không thiếu ID, không trùng ID và không đánh dấu sẵn ô nghiệm thu nào. Phần nguồn thiết kế giữ nguyên nội dung; nếu yêu cầu chưa khớp backend hiện tại, dùng ghi chú giới hạn ở mục UC tương ứng phía trên để ghi “Dự kiến”, không đánh dấu đạt.

### UC01

- [ ] **UC01.B01** (Luồng chính): Người dùng chọn "Đăng nhập" (nếu chưa có tài khoản → A1 Đăng ký).
- [ ] **UC01.B02** (Luồng chính): Hệ thống hiển thị form đăng nhập: Email/SĐT, Mật khẩu.
- [ ] **UC01.B03** (Luồng chính): Người dùng nhập thông tin đăng nhập. E1
- [ ] **UC01.B04** (Luồng chính): Người dùng nhấn "Đăng nhập".
- [ ] **UC01.B05** (Luồng chính): Hệ thống xác thực thông tin. E2, E3
- [ ] **UC01.B06** (Luồng chính): Hệ thống xác định vai trò và điều hướng đến giao diện tương ứng: Tourist → màn hình chính; Contributor → trang quản lý nội dung; Admin → trang kiểm duyệt.
- [ ] **UC01.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC01.A1** (Nhánh thay thế): Đăng ký (người dùng mới).
- [ ] **UC01.A1.01** (Bước nhánh thay thế): Người dùng chọn "Đăng ký".
- [ ] **UC01.A1.02** (Bước nhánh thay thế): Hệ thống hiển thị form đăng ký: Họ tên, Email/SĐT, Mật khẩu, Xác nhận mật khẩu, loại tài khoản (Khách / Người đăng nội dung).
- [ ] **UC01.A1.03** (Bước nhánh thay thế): Người dùng nhập thông tin. E4, E5, E6
- [ ] **UC01.A1.04** (Bước nhánh thay thế): Người dùng nhấn "Tiếp tục".
- [ ] **UC01.A1.05** (Bước nhánh thay thế): Hệ thống kiểm tra email/SĐT chưa tồn tại. E7
- [ ] **UC01.A1.06** (Bước nhánh thay thế): Hệ thống gửi mã OTP đến email/SĐT.
- [ ] **UC01.A1.07** (Bước nhánh thay thế): Người dùng nhập OTP. A3
- [ ] **UC01.A1.08** (Bước nhánh thay thế): Hệ thống xác thực OTP. E8
- [ ] **UC01.A1.09** (Bước nhánh thay thế): Hệ thống tạo tài khoản, thông báo "Đăng ký thành công" và quay về bước 1 (đăng nhập).
- [ ] **UC01.A2** (Nhánh thay thế): Quên mật khẩu.
- [ ] **UC01.A2.01** (Bước nhánh thay thế): Người dùng chọn "Quên mật khẩu", nhập email/SĐT.
- [ ] **UC01.A2.02** (Bước nhánh thay thế): Hệ thống gửi OTP, cho đặt lại mật khẩu mới, rồi quay về bước 1.
- [ ] **UC01.A3** (Nhánh thay thế): Gửi lại OTP.
- [ ] **UC01.A3.01** (Bước nhánh thay thế): Người dùng nhấn "Gửi lại OTP".
- [ ] **UC01.A3.02** (Bước nhánh thay thế): Hệ thống gửi mã OTP mới.
- [ ] **UC01.E1** (Ngoại lệ/lỗi): Bỏ trống thông tin đăng nhập → thông báo "Vui lòng nhập đầy đủ".
- [ ] **UC01.E2** (Ngoại lệ/lỗi): Email/SĐT hoặc mật khẩu sai → thông báo; sai quá số lần quy định → tạm khóa đăng nhập.
- [ ] **UC01.E3** (Ngoại lệ/lỗi): Tài khoản bị khóa/ban → thông báo lý do, hướng dẫn liên hệ Admin (UC21).
- [ ] **UC01.E4** (Ngoại lệ/lỗi): Bỏ trống trường bắt buộc khi đăng ký → thông báo "Vui lòng điền đầy đủ thông tin".
- [ ] **UC01.E5** (Ngoại lệ/lỗi): Email/SĐT sai định dạng → thông báo "Email/Số điện thoại không hợp lệ".
- [ ] **UC01.E6** (Ngoại lệ/lỗi): Mật khẩu không hợp lệ (quá ngắn, thiếu chữ/số) → thông báo "Mật khẩu không hợp lệ".
- [ ] **UC01.E7** (Ngoại lệ/lỗi): Email/SĐT đã tồn tại → thông báo "Tài khoản đã được đăng ký".
- [ ] **UC01.E8** (Ngoại lệ/lỗi): OTP sai hoặc hết hạn → thông báo "OTP không hợp lệ, vui lòng thử lại".
- [ ] **UC01.ASM01** (Giả định vận hành): Người dùng có thiết bị nhận OTP (SMS/Email); hệ thống kết nối server OTP.
- [ ] **UC01.PRE01** (Điều kiện trước): Để đăng nhập: tài khoản đã tồn tại và chưa bị ban.
- [ ] **UC01.PRE02** (Điều kiện trước): Để đăng ký: chưa có tài khoản với email/SĐT đó.
- [ ] **UC01.POST01** (Kết quả sau): Người dùng có tài khoản mới (đăng ký) và/hoặc đã đăng nhập, được điều hướng theo vai trò.
- [ ] **UC01.BR01** (Quy tắc nghiệp vụ): Một email/SĐT chỉ đăng ký được một tài khoản.
- [ ] **UC01.BR02** (Quy tắc nghiệp vụ): Mật khẩu tối thiểu 8 ký tự, gồm chữ và số; OTP hợp lệ trong 2 phút.
- [ ] **UC01.BR03** (Quy tắc nghiệp vụ): Phân quyền theo vai trò (Tourist / Contributor / Admin); sai mật khẩu nhiều lần → tạm khóa; tài khoản bị ban không đăng nhập được (UC21).
- [ ] **UC01.BR04** (Quy tắc nghiệp vụ): Khách du lịch không bắt buộc đăng ký để dùng tính năng cơ bản (tìm/tải/đi tour); chỉ cần tài khoản khi muốn đồng bộ. Contributor/Admin bắt buộc có tài khoản.

### UC02

- [ ] **UC02.B01** (Luồng chính): Tourist chọn chức năng "Tìm tour".
- [ ] **UC02.B02** (Luồng chính): Hệ thống hiển thị ô tìm kiếm, bộ lọc (thành phố, ngôn ngữ, loại) và danh sách tour phổ biến/gợi ý.
- [ ] **UC02.B03** (Luồng chính): Tourist nhập từ khóa/chọn thành phố/áp bộ lọc. A1
- [ ] **UC02.B04** (Luồng chính): Tourist nhấn "Tìm".
- [ ] **UC02.B05** (Luồng chính): Hệ thống hiển thị danh sách tour công khai (đã duyệt) khớp: ảnh bìa, tên, số điểm, thời lượng, điểm đánh giá, nhãn "giọng người thật / giọng máy (TTS)". E1, E2
- [ ] **UC02.B06** (Luồng chính): Tourist chọn một tour.
- [ ] **UC02.B07** (Luồng chính): Hệ thống hiển thị chi tiết tour: ảnh bìa, mô tả, số điểm dừng, thời lượng, route trên bản đồ, điểm đánh giá trung bình, nhãn giọng, và phần đánh giá/nhận xét. E3
- [ ] **UC02.B08** (Luồng chính): Tourist chọn ngôn ngữ nghe. A2
- [ ] **UC02.B09** (Luồng chính): Hệ thống cập nhật nhãn giọng theo ngôn ngữ (có audio người thật đúng ngôn ngữ → "giọng người thật"; nếu không → "giọng máy (TTS)").
- [ ] **UC02.B10** (Luồng chính): Tourist chọn hành động: Tải tour / Nghe thử từ xa / Bắt đầu (nếu đã tải). A3
- [ ] **UC02.B11** (Luồng chính): Hệ thống chuyển sang use case tương ứng (UC03 Tải / UC04 Nghe tour).
- [ ] **UC02.B12** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC02.A1** (Nhánh thay thế): Sắp xếp / lọc nâng cao.
- [ ] **UC02.A1.01** (Bước nhánh thay thế): Tourist chọn tiêu chí sắp xếp (phổ biến, đánh giá cao, gần tôi) hoặc lọc nâng cao.
- [ ] **UC02.A1.02** (Bước nhánh thay thế): Hệ thống sắp xếp/lọc lại danh sách, quay về bước 5.
- [ ] **UC02.A2** (Nhánh thay thế): Đổi ngôn ngữ nghe.
- [ ] **UC02.A2.01** (Bước nhánh thay thế): Tourist chọn ngôn ngữ khác.
- [ ] **UC02.A2.02** (Bước nhánh thay thế): Hệ thống cập nhật nhãn giọng và nội dung tương ứng, quay về bước 9.
- [ ] **UC02.A3** (Nhánh thay thế): Báo cáo tour.
- [ ] **UC02.A3.01** (Bước nhánh thay thế): Tourist chọn "Báo cáo" trên trang chi tiết.
- [ ] **UC02.A3.02** (Bước nhánh thay thế): Hệ thống chuyển sang UC06 – Báo cáo tour vi phạm.
- [ ] **UC02.E1** (Ngoại lệ/lỗi): Không có tour khớp → thông báo "Không tìm thấy tour phù hợp" và gợi ý tour phổ biến.
- [ ] **UC02.E2** (Ngoại lệ/lỗi): Mất mạng khi tìm online → thông báo, cho Thử lại hoặc xem tour đã tải (UC03).
- [ ] **UC02.E3** (Ngoại lệ/lỗi): Tour không còn khả dụng (đã ẩn/xóa) → thông báo và quay lại danh sách.
- [ ] **UC02.ASM01** (Giả định vận hành): Có kết nối internet để tìm/xem tour online (trừ tour đã tải).
- [ ] **UC02.PRE01** (Điều kiện trước): App đã mở; có tour công khai trong hệ thống. Không bắt buộc đăng nhập.
- [ ] **UC02.POST01** (Kết quả sau): Tourist xem được chi tiết tour và ngôn ngữ nghe; có thể tải hoặc bắt đầu tour.
- [ ] **UC02.BR01** (Quy tắc nghiệp vụ): Chỉ tour "Công khai (đã được Admin duyệt)" mới hiển thị trong tìm kiếm công khai; tour Nháp/Truy cập hạn chế/Chờ duyệt/Đang bị ẩn không hiển thị.
- [ ] **UC02.BR02** (Quy tắc nghiệp vụ): Nhãn giọng theo nguyên tắc ưu tiên audio người thật; không có → "giọng máy (TTS)".
- [ ] **UC02.BR03** (Quy tắc nghiệp vụ): Ngôn ngữ chọn quyết định audio sẽ phát (người thật đúng ngôn ngữ → ưu tiên; nếu không → TTS).
- [ ] **UC02.BR04** (Quy tắc nghiệp vụ): Tìm kiếm, xem đánh giá, chọn ngôn ngữ là các action trong cùng use case này (gộp từ T1 + T2/T3/T4/T24).

### UC03

- [ ] **Dự kiến** — **UC03.B01** (Luồng chính): Tourist (từ chi tiết tour – UC02) xác nhận ngôn ngữ và nhấn "Tải tour".
- [ ] **Dự kiến** — **UC03.B02** (Luồng chính): Hệ thống kiểm tra dung lượng trống và kết nối mạng. E1, E2
- [ ] **Dự kiến** — **UC03.B03** (Luồng chính): Hệ thống chuẩn bị gói tải: text, ảnh, dữ liệu bản đồ/route/vùng kích hoạt, audio người thật (nếu có) và audio TTS pre-render theo ngôn ngữ đã chọn.
- [ ] **Dự kiến** — **UC03.B04** (Luồng chính): Hệ thống tải và hiển thị tiến trình. A1, E3
- [ ] **Dự kiến** — **UC03.B05** (Luồng chính): Hệ thống lưu tour, đánh dấu "Đã tải" và thông báo "Tải tour thành công".
- [ ] **Dự kiến** — **UC03.B06** (Luồng chính): Tourist mở mục "Tour đã tải" để xem danh sách (dung lượng, ngôn ngữ) và quản lý. A2, A3
- [ ] **Dự kiến** — **UC03.B07** (Luồng chính): Hệ thống hiển thị danh sách tour đã tải và tổng dung lượng đang dùng. E4
- [ ] **Dự kiến** — **UC03.B08** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC03.A1** (Nhánh thay thế): Tạm dừng / hủy tải.
- [ ] **Dự kiến** — **UC03.A1.01** (Bước nhánh thay thế): Tourist nhấn Tạm dừng hoặc Hủy khi đang tải.
- [ ] **Dự kiến** — **UC03.A1.02** (Bước nhánh thay thế): Hệ thống dừng tải; hủy → dọn dữ liệu tải dở; tạm dừng → giữ phần đã tải.
- [ ] **Dự kiến** — **UC03.A2** (Nhánh thay thế): Xóa tour đã tải.
- [ ] **Dự kiến** — **UC03.A2.01** (Bước nhánh thay thế): Tourist chọn Xóa một tour, xác nhận.
- [ ] **Dự kiến** — **UC03.A2.02** (Bước nhánh thay thế): Hệ thống xóa dữ liệu tour khỏi máy và cập nhật dung lượng.
- [ ] **Dự kiến** — **UC03.A3** (Nhánh thay thế): Thêm/xóa một ngôn ngữ của tour đã tải; mở tour để đi.
- [ ] **Dự kiến** — **UC03.A3.01** (Bước nhánh thay thế): Tourist tải thêm/xóa một ngôn ngữ, hoặc chọn "Bắt đầu" một tour đã tải.
- [ ] **Dự kiến** — **UC03.A3.02** (Bước nhánh thay thế): Hệ thống cập nhật gói ngôn ngữ, hoặc chuyển sang UC04 – Nghe tour (chạy offline).
- [ ] **Dự kiến** — **UC03.E1** (Ngoại lệ/lỗi): Không đủ dung lượng → thông báo, gợi ý xóa bớt tour (A2).
- [ ] **Dự kiến** — **UC03.E2** (Ngoại lệ/lỗi): Không có mạng khi tải → thông báo cần kết nối Wi-Fi/internet.
- [ ] **Dự kiến** — **UC03.E3** (Ngoại lệ/lỗi): Lỗi/mất mạng giữa chừng → thông báo, cho Tiếp tục/Thử lại, giữ phần đã tải.
- [ ] **Dự kiến** — **UC03.E4** (Ngoại lệ/lỗi): Chưa tải tour nào → danh sách rỗng, gợi ý tìm tour (UC02).
- [ ] **Dự kiến** — **UC03.ASM01** (Giả định vận hành): Thiết bị có đủ dung lượng và có Wi-Fi/internet lúc tải.
- [ ] **Dự kiến** — **UC03.PRE01** (Điều kiện trước): Tour ở trạng thái công khai; tourist đã chọn ngôn ngữ (UC02).
- [ ] **Dự kiến** — **UC03.POST01** (Kết quả sau): Tour (kèm audio theo ngôn ngữ) được lưu/xoá trên máy; sẵn sàng dùng offline (UC04).
- [ ] **Dự kiến** — **UC03.BR01** (Quy tắc nghiệp vụ): Audio TTS pre-render & cache khi tải để đảm bảo chạy offline (UC04).
- [ ] **Dự kiến** — **UC03.BR02** (Quy tắc nghiệp vụ): Tải theo ngôn ngữ đã chọn; có thể tải thêm nhiều ngôn ngữ.
- [ ] **Dự kiến** — **UC03.BR03** (Quy tắc nghiệp vụ): Dữ liệu tải lưu cục bộ; xóa tour giải phóng dung lượng.
- [ ] **Dự kiến** — **UC03.BR04** (Quy tắc nghiệp vụ): Tải, xem danh sách, xóa là các action trong cùng use case này (gộp từ T5 + T6).

### UC04

- [ ] **UC04.B01** (Luồng chính): Tourist mở tour và nhấn "Bắt đầu tour" (muốn xem trước khi đến nơi → A5 Nghe thử từ xa).
- [ ] **UC04.B02** (Luồng chính): Hệ thống kiểm tra quyền GPS và dữ liệu tour (text, ảnh, audio, route, vùng kích hoạt). E1, E2
- [ ] **UC04.B03** (Luồng chính): Hệ thống hiển thị bản đồ: vị trí GPS, các điểm dừng và route.
- [ ] **UC04.B04** (Luồng chính): Tourist di chuyển theo route ngoài thực địa.
- [ ] **UC04.B05** (Luồng chính): Hệ thống liên tục cập nhật vị trí GPS.
- [ ] **UC04.B06** (Luồng chính): Tourist vào vùng kích hoạt của một điểm.
- [ ] **UC04.B07** (Luồng chính): Hệ thống tự động phát audio điểm: ưu tiên người thật đúng ngôn ngữ, nếu không → TTS đã cache. A1, A2, E3
- [ ] **UC04.B08** (Luồng chính): Hệ thống hiển thị text và ảnh của điểm.
- [ ] **UC04.B09** (Luồng chính): Tourist vào vùng chỉ đường ở ngã rẽ.
- [ ] **UC04.B10** (Luồng chính): Hệ thống tự phát audio chỉ đường.
- [ ] **UC04.B11** (Luồng chính): Sau khi nghe xong điểm, hệ thống phát gợi ý "đi tiếp đến đâu" (nếu tác giả có cấu hình).
- [ ] **UC04.B12** (Luồng chính): Tourist điều khiển audio: phát/tạm dừng, tua, chuyển điểm trước/sau. A3
- [ ] **UC04.B13** (Luồng chính): Tourist tiếp tục đến điểm cuối. A4
- [ ] **UC04.B14** (Luồng chính): Khi hoàn thành, hệ thống thông báo kết thúc và gợi ý đánh giá (UC05).
- [ ] **UC04.B15** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC04.A1** (Nhánh thay thế): Nhiều vùng kích hoạt chồng nhau → hệ thống phát audio của điểm có độ ưu tiên cao nhất (theo cấu hình tác giả), quay về bước 8.
- [ ] **UC04.A2** (Nhánh thay thế): Đang phát điểm này thì vào vùng điểm khác → hệ thống so độ ưu tiên: cao hơn thì chuyển phát ngay, thấp hơn thì chờ phát xong, quay về bước 7.
- [ ] **UC04.A3** (Nhánh thay thế): Chọn điểm thủ công → tourist chọn điểm trên bản đồ/danh sách, hệ thống phát audio điểm đó không cần đến vùng kích hoạt, quay về bước 8.
- [ ] **UC04.A4** (Nhánh thay thế): Tạm rời và quay lại → hệ thống lưu tiến độ; khi quay lại tiếp tục từ vị trí hiện tại, quay về bước 5.
- [ ] **UC04.A5** (Nhánh thay thế): Nghe thử từ xa (không cần GPS).
- [ ] **UC04.A5.01** (Bước nhánh thay thế): Tourist chọn "Nghe thử từ xa" (từ chi tiết tour – UC02).
- [ ] **UC04.A5.02** (Bước nhánh thay thế): Hệ thống mở chế độ nghe thủ công: danh sách điểm + trình phát audio, không dùng GPS.
- [ ] **UC04.A5.03** (Bước nhánh thay thế): Tourist chọn một điểm.
- [ ] **UC04.A5.04** (Bước nhánh thay thế): Hệ thống phát audio điểm (người thật/TTS) và hiển thị text/ảnh.
- [ ] **UC04.A5.05** (Bước nhánh thay thế): Tourist chuyển điểm trước/sau, đổi ngôn ngữ. Kết thúc chế độ nghe thử.
- [ ] **UC04.E1** (Ngoại lệ/lỗi): Chưa cấp quyền GPS → yêu cầu cấp quyền; từ chối → gợi ý nghe thử từ xa (A5).
- [ ] **UC04.E2** (Ngoại lệ/lỗi): GPS yếu/không ổn định → cảnh báo độ chính xác thấp, cho chọn điểm thủ công.
- [ ] **UC04.E3** (Ngoại lệ/lỗi): Thiếu/hỏng file audio → fallback phát TTS từ text; vẫn lỗi → hiển thị text kèm thông báo.
- [ ] **UC04.E4** (Ngoại lệ/lỗi): Mất mạng: tour đã tải chạy đầy đủ (GPS + audio offline); chưa tải → thông báo cần tải tour hoặc có kết nối.
- [ ] **UC04.ASM01** (Giả định vận hành): Thiết bị có GPS, còn pin; đã cấp quyền vị trí (với chế độ đi tour).
- [ ] **UC04.PRE01** (Điều kiện trước): Tour đã mở hoặc đã tải (UC03); ngôn ngữ đã chọn (UC02); vùng kích hoạt đã cấu hình (UC11).
- [ ] **UC04.POST01** (Kết quả sau): Tourist đã nghe nội dung các điểm; tiến độ được lưu; có thể đánh giá.
- [ ] **UC04.BR01** (Quy tắc nghiệp vụ): Khi phát: ưu tiên audio người thật đúng ngôn ngữ; không có → TTS.
- [ ] **UC04.BR02** (Quy tắc nghiệp vụ): Audio TTS pre-render & cache khi tải (UC03) để chạy offline.
- [ ] **UC04.BR03** (Quy tắc nghiệp vụ): Vùng kích hoạt chồng nhau → phát theo độ ưu tiên tác giả đặt.
- [ ] **UC04.BR04** (Quy tắc nghiệp vụ): Tour đã tải hoạt động đầy đủ offline.
- [ ] **UC04.BR05** (Quy tắc nghiệp vụ): Chế độ nghe thử từ xa không cần GPS (phần còn lại của chế độ museum). Điều khiển phát/tua/chuyển điểm là action.

### UC05

- [ ] **Dự kiến** — **UC05.B01** (Luồng chính): Tourist chọn "Đánh giá" (sau khi kết thúc tour ở UC04, hoặc từ chi tiết tour UC02).
- [ ] **Dự kiến** — **UC05.B02** (Luồng chính): Hệ thống hiển thị form đánh giá: số sao (1–5), ô nhận xét, tùy chọn đính kèm ảnh. E1
- [ ] **Dự kiến** — **UC05.B03** (Luồng chính): Tourist chọn số sao và nhập nhận xét. E2
- [ ] **Dự kiến** — **UC05.B04** (Luồng chính): Tourist nhấn "Gửi".
- [ ] **Dự kiến** — **UC05.B05** (Luồng chính): Hệ thống lưu đánh giá, cập nhật điểm trung bình của tour và hiển thị nhận xét.
- [ ] **Dự kiến** — **UC05.B06** (Luồng chính): Hệ thống thông báo "Cảm ơn đánh giá của bạn".
- [ ] **Dự kiến** — **UC05.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC05.A1** (Nhánh thay thế): Sửa / xóa đánh giá của mình.
- [ ] **Dự kiến** — **UC05.A1.01** (Bước nhánh thay thế): Tourist mở đánh giá đã gửi, chọn Sửa hoặc Xóa.
- [ ] **Dự kiến** — **UC05.A1.02** (Bước nhánh thay thế): Hệ thống cập nhật/xóa đánh giá và tính lại điểm trung bình.
- [ ] **Dự kiến** — **UC05.E1** (Ngoại lệ/lỗi): Chưa đăng nhập (nếu chính sách yêu cầu) → gợi ý đăng nhập (UC01).
- [ ] **Dự kiến** — **UC05.E2** (Ngoại lệ/lỗi): Gửi khi chưa chọn sao → thông báo "Vui lòng chọn số sao".
- [ ] **Dự kiến** — **UC05.ASM01** (Giả định vận hành): Tourist đã đi hoặc nghe tour.
- [ ] **Dự kiến** — **UC05.PRE01** (Điều kiện trước): Tour tồn tại; tourist đã (hoặc đang) trải nghiệm tour.
- [ ] **Dự kiến** — **UC05.POST01** (Kết quả sau): Đánh giá được lưu; điểm trung bình và thống kê tour được cập nhật (phục vụ UC17).
- [ ] **Dự kiến** — **UC05.BR01** (Quy tắc nghiệp vụ): Mỗi tài khoản đánh giá một lần/tour (có thể sửa lại).
- [ ] **Dự kiến** — **UC05.BR02** (Quy tắc nghiệp vụ): Nội dung nhận xét có thể bị kiểm duyệt; đánh giá gắn tài khoản để chống spam.

### UC06

- [ ] **Dự kiến** — **UC06.B01** (Luồng chính): Tourist (từ chi tiết tour UC02 hoặc trong khi nghe) chọn "Báo cáo".
- [ ] **Dự kiến** — **UC06.B02** (Luồng chính): Hệ thống hiển thị form với danh sách lý do: sai sự thật / phản cảm / spam / vi phạm bản quyền / khác (kèm ô ghi chú). E1
- [ ] **Dự kiến** — **UC06.B03** (Luồng chính): Tourist chọn lý do (nhập mô tả nếu "khác"). E2
- [ ] **Dự kiến** — **UC06.B04** (Luồng chính): Tourist nhấn "Gửi báo cáo".
- [ ] **Dự kiến** — **UC06.B05** (Luồng chính): Hệ thống lưu báo cáo (người báo cáo, lý do, thời gian) và tăng bộ đếm report của tour.
- [ ] **Dự kiến** — **UC06.B06** (Luồng chính): Hệ thống kiểm tra ngưỡng tự động. A1
- [ ] **Dự kiến** — **UC06.B07** (Luồng chính): Hệ thống thông báo "Đã gửi báo cáo, cảm ơn bạn".
- [ ] **Dự kiến** — **UC06.B08** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC06.A1** (Nhánh thay thế): Tour đạt ngưỡng báo cáo tự động.
- [ ] **Dự kiến** — **UC06.A1.01** (Bước nhánh thay thế): Nếu tour nhận ≥ 5 báo cáo khác nhau trong 7 ngày, hệ thống tự chuyển tour sang "Chờ Admin xem lại" (không ẩn hẳn) để Admin xử lý (UC20).
- [ ] **Dự kiến** — **UC06.E1** (Ngoại lệ/lỗi): Chưa đăng nhập (nếu yêu cầu) → gợi ý đăng nhập (UC01) để chống spam báo cáo.
- [ ] **Dự kiến** — **UC06.E2** (Ngoại lệ/lỗi): Chưa chọn lý do → thông báo "Vui lòng chọn lý do báo cáo".
- [ ] **Dự kiến** — **UC06.ASM01** (Giả định vận hành): Tour đang ở trạng thái công khai.
- [ ] **Dự kiến** — **UC06.PRE01** (Điều kiện trước): Tour tồn tại và công khai.
- [ ] **Dự kiến** — **UC06.POST01** (Kết quả sau): Báo cáo được ghi nhận; nếu đạt ngưỡng, tour chuyển sang "Chờ Admin xem lại".
- [ ] **Dự kiến** — **UC06.BR01** (Quy tắc nghiệp vụ): Tầng 3 – Community report trong mô hình kiểm duyệt 3 tầng.
- [ ] **Dự kiến** — **UC06.BR02** (Quy tắc nghiệp vụ): Tour nhận ≥ 5 báo cáo khác nhau trong 7 ngày → tự chuyển "Chờ Admin xem lại" (không ẩn hẳn, tránh report bomb — Admin có thể khôi phục).
- [ ] **Dự kiến** — **UC06.BR03** (Quy tắc nghiệp vụ): Mỗi tài khoản chỉ báo cáo một lần cho mỗi tour.

### UC07

- [ ] **UC07.B01** (Luồng chính): Tourist chọn "Khám phá địa điểm" để tìm địa điểm lẻ. A1, E1
- [ ] **UC07.B02** (Luồng chính): Hệ thống hiển thị bản đồ/danh sách địa điểm kèm ô tìm kiếm và bộ lọc.
- [ ] **UC07.B03** (Luồng chính): Tourist chọn một địa điểm để xem chi tiết (tên, loại, mô tả, ảnh, audio nếu có).
- [ ] **UC07.B04** (Luồng chính): Tourist chọn "Thêm vào lịch trình".
- [ ] **UC07.B05** (Luồng chính): Hệ thống yêu cầu đặt tên lịch trình (nếu chưa có). E2
- [ ] **UC07.B06** (Luồng chính): Tourist thêm các địa điểm, sắp xếp thứ tự, thêm/xóa điểm. A2
- [ ] **UC07.B07** (Luồng chính): Hệ thống hiển thị lịch trình trên bản đồ kèm khoảng cách và thời gian di chuyển ước tính.
- [ ] **UC07.B08** (Luồng chính): Tourist tải lịch trình offline hoặc chia sẻ cho bạn bè. A3, A4
- [ ] **UC07.B09** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC07.A1** (Nhánh thay thế): Tìm / lọc địa điểm → hệ thống hiển thị kết quả theo bộ lọc.
- [ ] **UC07.A2** (Nhánh thay thế): Sắp xếp / thêm / xóa địa điểm → hệ thống cập nhật lịch trình và tính lại khoảng cách/thời gian.
- [ ] **UC07.A3** (Nhánh thay thế): Tải lịch trình offline → hệ thống tải dữ liệu lịch trình (và audio các điểm) về máy.
- [ ] **UC07.A4** (Nhánh thay thế): Chia sẻ lịch trình (tùy chọn) → hệ thống tạo liên kết/mã chia sẻ.
- [ ] **UC07.E1** (Ngoại lệ/lỗi): Không tìm thấy địa điểm phù hợp → gợi ý địa điểm gần/phổ biến.
- [ ] **UC07.E2** (Ngoại lệ/lỗi): Thiếu tên lịch trình → yêu cầu nhập tên.
- [ ] **UC07.ASM01** (Giả định vận hành): Tourist đã đăng nhập (lịch trình gắn tài khoản).
- [ ] **UC07.PRE01** (Điều kiện trước): Tourist đã đăng nhập (UC01); hệ thống có dữ liệu địa điểm được phép hiển thị lẻ.
- [ ] **UC07.POST01** (Kết quả sau): Lịch trình cá nhân được tạo/lưu; có thể tải offline và chia sẻ.
- [ ] **UC07.BR01** (Quy tắc nghiệp vụ): Lịch trình gắn với tài khoản; chia sẻ là tùy chọn.
- [ ] **UC07.BR02** (Quy tắc nghiệp vụ): Chỉ hiển thị địa điểm thuộc tour công khai hoặc địa điểm được phép hiển thị riêng lẻ.
- [ ] **UC07.BR03** (Quy tắc nghiệp vụ): Tìm địa điểm lẻ, sắp xếp/thêm/xóa, chia sẻ là các action trong cùng use case này (gộp từ T16 + T17–T20/T22).

### UC08

- [ ] **UC08.B01** (Luồng chính): Tourist mở một lịch trình và nhấn "Bắt đầu".
- [ ] **UC08.B02** (Luồng chính): Hệ thống hiển thị bản đồ với vị trí GPS và các điểm trong lịch trình theo thứ tự. E1
- [ ] **UC08.B03** (Luồng chính): Tourist di chuyển ngoài thực địa.
- [ ] **UC08.B04** (Luồng chính): Hệ thống cập nhật GPS và tự phát audio điểm khi tourist đến gần (ưu tiên người thật, nếu không → TTS). A1
- [ ] **UC08.B05** (Luồng chính): Tourist điều khiển phát và chuyển điểm.
- [ ] **UC08.B06** (Luồng chính): Khi hoàn thành các điểm, hệ thống hiển thị thông báo kết thúc.
- [ ] **UC08.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC08.A1** (Nhánh thay thế): Chọn điểm thủ công.
- [ ] **UC08.A1.01** (Bước nhánh thay thế): Tourist chọn một điểm trong lịch trình.
- [ ] **UC08.A1.02** (Bước nhánh thay thế): Hệ thống phát audio điểm đó mà không cần đến gần.
- [ ] **UC08.E1** (Ngoại lệ/lỗi): Chưa cấp GPS hoặc tín hiệu yếu → cảnh báo và cho nghe thủ công (tương tự UC04).
- [ ] **UC08.ASM01** (Giả định vận hành): Thiết bị có GPS; lịch trình đã được tạo (UC07).
- [ ] **UC08.PRE01** (Điều kiện trước): Tourist đã có lịch trình cá nhân (đã tải nếu đi offline).
- [ ] **UC08.POST01** (Kết quả sau): Tourist đã đi và nghe audio theo lịch trình của mình.
- [ ] **UC08.BR01** (Quy tắc nghiệp vụ): Trải nghiệm tương tự UC04 nhưng nguồn điểm là lịch trình cá nhân.
- [ ] **UC08.BR02** (Quy tắc nghiệp vụ): Hoạt động offline nếu lịch trình đã tải; audio ưu tiên người thật → TTS.

### UC09

- [ ] **UC09.B01** (Luồng chính): Contributor vào trang quản lý nội dung.
- [ ] **UC09.B02** (Luồng chính): Hệ thống hiển thị danh sách tour của contributor kèm trạng thái: Nháp / Chờ AI / AI Warning / Chờ Admin duyệt / Công khai / Bị từ chối / Truy cập hạn chế / Đang bị ẩn. E1
- [ ] **UC09.B03** (Luồng chính): Contributor chọn "Tạo tour mới" (hoặc A1 Sửa / A2 Xóa / A3 Gửi duyệt một tour có sẵn).
- [ ] **UC09.B04** (Luồng chính): Hệ thống hiển thị form tạo tour: tên, mô tả ngắn, ảnh bìa, ngôn ngữ gốc (bắt buộc), loại tour. E2, E3
- [ ] **UC09.B05** (Luồng chính): Contributor nhập thông tin và upload ảnh bìa.
- [ ] **UC09.B06** (Luồng chính): (Upload ảnh bìa) Hệ thống tự quét NSFW tại trình duyệt. E4
- [ ] **UC09.B07** (Luồng chính): Contributor nhấn "Tạo".
- [ ] **UC09.B08** (Luồng chính): Hệ thống tạo tour ở trạng thái "Nháp" và mở trình chỉnh sửa để thêm địa điểm (UC10).
- [ ] **UC09.B09** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC09.A1** (Nhánh thay thế): Sửa tour.
- [ ] **UC09.A1.01** (Bước nhánh thay thế): Contributor chọn Sửa một tour.
- [ ] **UC09.A1.02** (Bước nhánh thay thế): Hệ thống mở trình chỉnh sửa (UC10 – địa điểm, UC11 – route).
- [ ] **UC09.A2** (Nhánh thay thế): Xóa tour.
- [ ] **UC09.A2.01** (Bước nhánh thay thế): Contributor chọn Xóa một tour, xác nhận.
- [ ] **UC09.A2.02** (Bước nhánh thay thế): Hệ thống xóa tour (kể cả tour công khai) và gỡ khỏi kết quả tìm kiếm (UC02).
- [ ] **UC09.A3** (Nhánh thay thế): Gửi tour đi duyệt.
- [ ] **UC09.A3.01** (Bước nhánh thay thế): Contributor chọn "Gửi duyệt" một tour Nháp.
- [ ] **UC09.A3.02** (Bước nhánh thay thế): Hệ thống chuyển sang UC15 – Gửi tour đi duyệt.
- [ ] **UC09.A4** (Nhánh thay thế): Lưu nháp và thoát → hệ thống lưu tour ở trạng thái Nháp, quay về danh sách.
- [ ] **UC09.E1** (Ngoại lệ/lỗi): Chưa có tour nào → danh sách rỗng, gợi ý tạo tour.
- [ ] **UC09.E2** (Ngoại lệ/lỗi): Thiếu trường bắt buộc (tên, ngôn ngữ gốc) → yêu cầu nhập đầy đủ.
- [ ] **UC09.E3** (Ngoại lệ/lỗi): Ảnh bìa sai định dạng/quá lớn → yêu cầu chọn ảnh khác.
- [ ] **UC09.E4** (Ngoại lệ/lỗi): Ảnh bìa vi phạm NSFW → từ chối upload và thông báo ngay.
- [ ] **UC09.ASM01** (Giả định vận hành): Contributor đã đăng nhập.
- [ ] **UC09.PRE01** (Điều kiện trước): Contributor có tài khoản hợp lệ (đã đăng nhập – UC01).
- [ ] **UC09.POST01** (Kết quả sau): Tour mới được tạo (Nháp) hoặc tour hiện có được sửa/xóa/gửi duyệt.
- [ ] **UC09.BR01** (Quy tắc nghiệp vụ): Tour mới mặc định Nháp; ngôn ngữ gốc bắt buộc; ảnh quét NSFW client-side (NSFW.js).
- [ ] **UC09.BR02** (Quy tắc nghiệp vụ): Chỉ tác giả tạo tour; khách du lịch không tạo tour.
- [ ] **UC09.BR03** (Quy tắc nghiệp vụ): Contributor sửa/xóa được tour của mình kể cả sau khi công khai; sửa tour công khai có thể phải gửi duyệt lại.
- [ ] **UC09.BR04** (Quy tắc nghiệp vụ): Tạo, xem danh sách, sửa, xóa là các action trong cùng use case này (gộp từ C3 + C4/C5).

### UC10

- [ ] **UC10.B01** (Luồng chính): Contributor mở trình chỉnh sửa tour và chọn "Thêm điểm".
- [ ] **UC10.B02** (Luồng chính): Hệ thống hiển thị bản đồ với hai cách thêm: tìm theo địa chỉ hoặc thả pin thủ công.
- [ ] **UC10.B03** (Luồng chính): Contributor tìm địa chỉ để định vị điểm. A1, E1
- [ ] **UC10.B04** (Luồng chính): (Khi đặt điểm) Hệ thống kiểm tra vị trí so với danh sách vùng cấm. E2
- [ ] **UC10.B05** (Luồng chính): Hệ thống mở form nội dung điểm: tên, loại địa điểm, mô tả text (bắt buộc), nhiều ảnh có chú thích, audio người thật (tùy chọn).
- [ ] **UC10.B06** (Luồng chính): Contributor nhập nội dung và upload ảnh. E3
- [ ] **UC10.B07** (Luồng chính): (Khi upload ảnh) Hệ thống tự quét NSFW tại trình duyệt. E4
- [ ] **UC10.B08** (Luồng chính): Contributor (tùy chọn) upload file audio người thật cho điểm.
- [ ] **UC10.B09** (Luồng chính): Nếu không có audio người thật, hệ thống dùng TTS đọc text làm audio cho điểm.
- [ ] **UC10.B10** (Luồng chính): Contributor lưu điểm.
- [ ] **UC10.B11** (Luồng chính): Hệ thống lưu điểm và hiển thị trên bản đồ + danh sách điểm.
- [ ] **UC10.B12** (Luồng chính): Contributor lặp lại để thêm nhiều điểm; sắp xếp/sửa/xóa điểm. A2, A3
- [ ] **UC10.B13** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC10.A1** (Nhánh thay thế): Thả pin thủ công → hệ thống ghi tọa độ, tiếp tục ở bước 4.
- [ ] **UC10.A2** (Nhánh thay thế): Sắp xếp lại thứ tự điểm → hệ thống cập nhật thứ tự.
- [ ] **UC10.A3** (Nhánh thay thế): Sửa / Xóa điểm → hệ thống cập nhật hoặc xóa điểm khỏi tour.
- [ ] **UC10.E1** (Ngoại lệ/lỗi): Không tìm thấy địa chỉ → gợi ý thả pin thủ công (A1).
- [ ] **UC10.E2** (Ngoại lệ/lỗi): Điểm nằm trong vùng cấm (quân sự, trường học, bệnh viện, lãnh sự quán) → cảnh báo, yêu cầu điều chỉnh vị trí.
- [ ] **UC10.E3** (Ngoại lệ/lỗi): Thiếu text mô tả (bắt buộc) → chặn lưu và yêu cầu nhập.
- [ ] **UC10.E4** (Ngoại lệ/lỗi): Ảnh vi phạm NSFW → từ chối upload ảnh đó.
- [ ] **UC10.ASM01** (Giả định vận hành): Dịch vụ bản đồ/geocoding khả dụng.
- [ ] **UC10.PRE01** (Điều kiện trước): Tour đã được tạo (UC09), đang ở Nháp; contributor đã đăng nhập.
- [ ] **UC10.POST01** (Kết quả sau): Các điểm dừng (text bắt buộc, ảnh, audio người thật hoặc TTS) được lưu vào tour.
- [ ] **UC10.BR01** (Quy tắc nghiệp vụ): Text mô tả bắt buộc cho mỗi điểm — nguồn nội dung chính, dùng cho kiểm duyệt AI và hiển thị cùng audio.
- [ ] **UC10.BR02** (Quy tắc nghiệp vụ): Audio người thật tùy chọn (mỗi điểm một file cho ngôn ngữ gốc); không có → dùng TTS.
- [ ] **UC10.BR03** (Quy tắc nghiệp vụ): Ảnh quét NSFW client-side; vị trí điểm kiểm vùng cấm bằng turf.js.
- [ ] **UC10.BR04** (Quy tắc nghiệp vụ): Tìm địa chỉ, thả pin, nhập nội dung, sắp xếp/xóa là các action trong use case này (C6–C9, C19, C20).

### UC11

- [ ] **UC11.B01** (Luồng chính): Contributor mở tab "Route & kích hoạt" trong trình chỉnh sửa tour.
- [ ] **UC11.B02** (Luồng chính): Hệ thống hiển thị bản đồ với các điểm đã thêm (từ UC10).
- [ ] **UC11.B03** (Luồng chính): Contributor vẽ đường route nối các điểm theo thứ tự. A1
- [ ] **UC11.B04** (Luồng chính): Contributor đặt vùng kích hoạt cho mỗi điểm (tròn hoặc đa giác, chỉnh bán kính/đỉnh). E1
- [ ] **UC11.B05** (Luồng chính): Contributor đặt độ ưu tiên cho các điểm có vùng kích hoạt chồng nhau. A2
- [ ] **UC11.B06** (Luồng chính): Contributor (tùy chọn) thêm audio chỉ đường với vùng kích hoạt riêng tại ngã rẽ. A3
- [ ] **UC11.B07** (Luồng chính): Contributor (tùy chọn) thêm gợi ý "đi tiếp đến đâu" phát sau khi nghe xong mỗi điểm.
- [ ] **UC11.B08** (Luồng chính): Contributor lưu cấu hình.
- [ ] **UC11.B09** (Luồng chính): Hệ thống lưu route, vùng kích hoạt, độ ưu tiên và audio chỉ đường/gợi ý.
- [ ] **UC11.B10** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC11.A1** (Nhánh thay thế): Điều chỉnh route → hệ thống cập nhật lại route.
- [ ] **UC11.A2** (Nhánh thay thế): Điều chỉnh độ ưu tiên → hệ thống lưu ưu tiên mới (áp dụng khi tourist đi tour – UC04).
- [ ] **UC11.A3** (Nhánh thay thế): Thêm/sửa/xóa audio chỉ đường → hệ thống cập nhật audio chỉ đường tương ứng.
- [ ] **UC11.E1** (Ngoại lệ/lỗi): Vùng kích hoạt không hợp lệ (bán kính 0, đa giác chưa khép kín) → báo lỗi, yêu cầu chỉnh.
- [ ] **UC11.ASM01** (Giả định vận hành): Tour đã có các điểm dừng với tọa độ hợp lệ.
- [ ] **UC11.PRE01** (Điều kiện trước): Tour có ít nhất 2 điểm (UC10); contributor đã đăng nhập.
- [ ] **UC11.POST01** (Kết quả sau): Route, vùng kích hoạt, độ ưu tiên và audio chỉ đường/gợi ý được lưu — sẵn sàng cho trải nghiệm tự phát audio của tourist (UC04).
- [ ] **UC11.BR01** (Quy tắc nghiệp vụ): Vùng kích hoạt dạng tròn hoặc đa giác, do tác giả tự đặt và chỉnh bán kính.
- [ ] **UC11.BR02** (Quy tắc nghiệp vụ): Khi các vùng chồng nhau, hệ thống (lúc chạy UC04) phát audio theo độ ưu tiên do tác giả đặt.
- [ ] **UC11.BR03** (Quy tắc nghiệp vụ): Vẽ route, đặt vùng, đặt ưu tiên, thêm audio chỉ đường là các action trong use case này (C10–C14).

### UC12

- [ ] **UC12.B01** (Luồng chính): Contributor mở mục "Ngôn ngữ & giọng đọc" của tour.
- [ ] **UC12.B02** (Luồng chính): Hệ thống hiển thị ngôn ngữ gốc và cho phép chọn các ngôn ngữ phụ.
- [ ] **UC12.B03** (Luồng chính): Contributor chọn các ngôn ngữ phụ cần hỗ trợ.
- [ ] **UC12.B04** (Luồng chính): Hệ thống tự động dịch text sang các ngôn ngữ phụ và chuẩn bị bản TTS. E1
- [ ] **UC12.B05** (Luồng chính): Contributor chọn giọng đọc TTS (nam/nữ, vùng miền).
- [ ] **UC12.B06** (Luồng chính): Contributor nghe thử bản TTS của từng điểm theo từng ngôn ngữ. A1
- [ ] **UC12.B07** (Luồng chính): Contributor chỉnh text gốc hoặc bản dịch nếu nghe sai tên riêng/thuật ngữ. A2
- [ ] **UC12.B08** (Luồng chính): Contributor lưu cấu hình ngôn ngữ.
- [ ] **UC12.B09** (Luồng chính): Hệ thống lưu các ngôn ngữ, bản dịch và giọng TTS.
- [ ] **UC12.B10** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC12.A1** (Nhánh thay thế): Nghe thử TTS → hệ thống phát bản TTS tương ứng.
- [ ] **UC12.A2** (Nhánh thay thế): Chỉnh text / bản dịch → hệ thống render lại TTS cho phần đã chỉnh, quay về bước 6.
- [ ] **UC12.E1** (Ngoại lệ/lỗi): Lỗi dịch/TTS (dịch vụ không phản hồi) → thông báo, cho thử lại.
- [ ] **UC12.ASM01** (Giả định vận hành): Dịch vụ dịch và TTS khả dụng.
- [ ] **UC12.PRE01** (Điều kiện trước): Tour đã có text mô tả cho các điểm (UC10); contributor đã đăng nhập.
- [ ] **UC12.POST01** (Kết quả sau): Tour hỗ trợ nhiều ngôn ngữ với bản dịch + TTS và giọng đọc đã chọn.
- [ ] **UC12.BR01** (Quy tắc nghiệp vụ): Ngôn ngữ gốc là nguồn; ngôn ngữ phụ được tự động dịch + TTS.
- [ ] **UC12.BR02** (Quy tắc nghiệp vụ): Khi tourist tải tour (UC03), audio TTS được pre-render & cache để chạy offline.
- [ ] **UC12.BR03** (Quy tắc nghiệp vụ): Khi phát (UC04): ưu tiên audio người thật đúng ngôn ngữ; không có → TTS.
- [ ] **UC12.BR04** (Quy tắc nghiệp vụ): Nghe thử TTS, chỉnh text/giọng là các action trong use case này (C24–C26).

### UC13

- [ ] **UC13.B01** (Luồng chính): Contributor chọn "Xem thử" trên tour.
- [ ] **UC13.B02** (Luồng chính): Hệ thống mở chế độ preview như khách: bản đồ, route, điểm, trình phát audio, với GPS giả lập. E1
- [ ] **UC13.B03** (Luồng chính): Contributor di chuyển điểm GPS giả lập dọc route. A1
- [ ] **UC13.B04** (Luồng chính): Hệ thống tự phát audio theo vùng kích hoạt giống trải nghiệm thật (như UC04).
- [ ] **UC13.B05** (Luồng chính): Contributor xem text/ảnh, kiểm tra nội dung, audio và vùng kích hoạt.
- [ ] **UC13.B06** (Luồng chính): Contributor thoát preview; nếu phát hiện lỗi thì quay lại chỉnh sửa. A2
- [ ] **UC13.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **UC13.A1** (Nhánh thay thế): Chọn điểm thủ công để nghe thử → hệ thống phát audio điểm đó không cần GPS giả lập.
- [ ] **UC13.A2** (Nhánh thay thế): Phát hiện lỗi → quay lại sửa → hệ thống chuyển về trình chỉnh sửa (UC10 / UC11 / UC12).
- [ ] **UC13.E1** (Ngoại lệ/lỗi): Tour thiếu dữ liệu (chưa có điểm hoặc route) → thông báo không thể preview, gợi ý bổ sung.
- [ ] **UC13.ASM01** (Giả định vận hành): Chế độ GPS giả lập khả dụng trong app.
- [ ] **UC13.PRE01** (Điều kiện trước): Tour đã có ít nhất một điểm và route (UC10, UC11); contributor đã đăng nhập.
- [ ] **UC13.POST01** (Kết quả sau): Contributor đã kiểm tra trải nghiệm tour; có thể sửa hoặc gửi duyệt.
- [ ] **UC13.BR01** (Quy tắc nghiệp vụ): Preview không công khai, chỉ để kiểm thử nội bộ.
- [ ] **UC13.BR02** (Quy tắc nghiệp vụ): Preview dùng GPS giả lập và mô phỏng đúng trải nghiệm tourist (UC04).

### UC14

- [ ] **Dự kiến** — **UC14.B01** (Luồng chính): Contributor chọn "Truy cập hạn chế" cho tour.
- [ ] **Dự kiến** — **UC14.B02** (Luồng chính): Hệ thống cho phép đặt passcode cho tour. E1
- [ ] **Dự kiến** — **UC14.B03** (Luồng chính): Contributor đặt passcode và lưu.
- [ ] **Dự kiến** — **UC14.B04** (Luồng chính): Hệ thống chuyển tour sang trạng thái "Truy cập hạn chế" (không hiển thị công khai trong tìm kiếm).
- [ ] **Dự kiến** — **UC14.B05** (Luồng chính): Contributor chia sẻ passcode cho nhóm test.
- [ ] **Dự kiến** — **UC14.B06** (Luồng chính): (Phía người test) Nhập passcode → xem và tải được tour để test.
- [ ] **Dự kiến** — **UC14.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC14.A1** (Nhánh thay thế): Đổi hoặc hủy passcode.
- [ ] **Dự kiến** — **UC14.A1.01** (Bước nhánh thay thế): Contributor đổi passcode hoặc tắt chế độ hạn chế.
- [ ] **Dự kiến** — **UC14.A1.02** (Bước nhánh thay thế): Hệ thống cập nhật passcode, hoặc chuyển tour về Nháp khi tắt chế độ hạn chế.
- [ ] **Dự kiến** — **UC14.E1** (Ngoại lệ/lỗi): Passcode không hợp lệ (quá ngắn/trống) → yêu cầu đặt lại.
- [ ] **Dự kiến** — **UC14.ASM01** (Giả định vận hành): Người test có passcode do contributor cung cấp.
- [ ] **Dự kiến** — **UC14.PRE01** (Điều kiện trước): Tour tồn tại (thường ở Nháp); contributor đã đăng nhập.
- [ ] **Dự kiến** — **UC14.POST01** (Kết quả sau): Tour ở chế độ truy cập hạn chế; chỉ ai có passcode mới truy cập.
- [ ] **Dự kiến** — **UC14.BR01** (Quy tắc nghiệp vụ): Chế độ truy cập hạn chế không cần Admin duyệt vì không công khai.
- [ ] **Dự kiến** — **UC14.BR02** (Quy tắc nghiệp vụ): Tour hạn chế không xuất hiện trong kết quả tìm kiếm công khai (UC02).
- [ ] **Dự kiến** — **UC14.BR03** (Quy tắc nghiệp vụ): Chỉ dùng cho mục đích test với nhóm nhỏ.

### UC15

- [ ] **Dự kiến** — **UC15.B01** (Luồng chính): Contributor mở tour ở trạng thái Nháp và nhấn "Gửi duyệt".
- [ ] **Dự kiến** — **UC15.B02** (Luồng chính): Hệ thống kiểm tra điều kiện tối thiểu: có tên tour, mô tả, ngôn ngữ gốc, ≥1 điểm, và mỗi điểm có text mô tả (bắt buộc). E1
- [ ] **Dự kiến** — **UC15.B03** (Luồng chính): Hệ thống chuyển trạng thái sang "Chờ AI" và chạy kiểm duyệt tự động: · a. Quét text (tiêu đề, mô tả tour, mô tả điểm) bằng Gemini API. · b. Kiểm tra kết quả quét ảnh NSFW (đã quét client-side lúc upload – UC10). · c. Kiểm tra vị trí các điểm so với vùng cấm bằng turf.js. E2, E3
- [ ] **Dự kiến** — **UC15.B04** (Luồng chính): Hệ thống tổng hợp kết quả: Pass / Warning / Reject kèm lý do. A1, A2
- [ ] **Dự kiến** — **UC15.B05** (Luồng chính): (Pass) Hệ thống chuyển tour sang "Chờ Admin duyệt" và đưa vào hàng chờ của Admin (UC19).
- [ ] **Dự kiến** — **UC15.B06** (Luồng chính): Hệ thống thông báo "Đã gửi duyệt thành công" kèm trạng thái hiện tại.
- [ ] **Dự kiến** — **UC15.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC15.A1** (Nhánh thay thế): Kết quả = Warning → tour vẫn chuyển "Chờ Admin duyệt" nhưng gắn cờ AI Warning (ưu tiên đầu hàng chờ); hiển thị cảnh báo + lý do cho contributor, quay về bước 6.
- [ ] **Dự kiến** — **UC15.A2** (Nhánh thay thế): Kết quả = Reject → hệ thống không đưa vào hàng chờ Admin; chuyển tour về "Nháp / bị AI từ chối", hiển thị lý do cụ thể và yêu cầu sửa rồi gửi lại. Use case kết thúc.
- [ ] **Dự kiến** — **UC15.A3** (Nhánh thay thế): Xem thử trước khi gửi → contributor chọn "Xem thử", hệ thống chuyển sang UC13 – Xem thử tour; sau đó quay lại bước 1.
- [ ] **Dự kiến** — **UC15.E1** (Ngoại lệ/lỗi): Thiếu điều kiện tối thiểu (chưa có điểm, thiếu text mô tả, thiếu tên/ngôn ngữ) → chặn gửi, liệt kê mục còn thiếu.
- [ ] **Dự kiến** — **UC15.E2** (Ngoại lệ/lỗi): Lỗi gọi AI (Gemini API timeout/lỗi) → giữ trạng thái "Chờ AI", thông báo đang xử lý, cho gửi lại sau.
- [ ] **Dự kiến** — **UC15.E3** (Ngoại lệ/lỗi): Có điểm trong vùng cấm → đánh dấu Warning/Reject tùy mức, chỉ rõ điểm vi phạm.
- [ ] **Dự kiến** — **UC15.ASM01** (Giả định vận hành): Dịch vụ AI (Gemini API) khả dụng; ảnh đã quét NSFW lúc upload (UC10).
- [ ] **Dự kiến** — **UC15.PRE01** (Điều kiện trước): Contributor đã đăng nhập; tour ở Nháp và đủ nội dung bắt buộc (mỗi điểm có text).
- [ ] **Dự kiến** — **UC15.POST01** (Kết quả sau): Tour chuyển trạng thái phù hợp: Chờ Admin duyệt (Pass) / Chờ Admin duyệt + AI Warning (Warning) / Nháp – cần sửa (Reject); có bản ghi kết quả kiểm duyệt AI.
- [ ] **Dự kiến** — **UC15.BR01** (Quy tắc nghiệp vụ): Mô hình kiểm duyệt 3 tầng; UC này là Tầng 1 – AI tự động khi nhấn "Gửi duyệt".
- [ ] **Dự kiến** — **UC15.BR02** (Quy tắc nghiệp vụ): Reject → trả contributor sửa, không vào hàng chờ Admin.
- [ ] **Dự kiến** — **UC15.BR03** (Quy tắc nghiệp vụ): Pass/Warning → chuyển Tầng 2 (Admin); tour AI Warning ưu tiên đầu hàng chờ.
- [ ] **Dự kiến** — **UC15.BR04** (Quy tắc nghiệp vụ): Text bắt buộc mỗi điểm (dùng cho kiểm duyệt AI & hiển thị cùng audio).
- [ ] **Dự kiến** — **UC15.BR05** (Quy tắc nghiệp vụ): Quét text bằng Gemini API, ảnh bằng NSFW.js (client-side), GPS vùng cấm bằng turf.js.

### UC16

- [ ] **Dự kiến** — **UC16.B01** (Luồng chính): Contributor mở trang quản lý nội dung / trung tâm thông báo.
- [ ] **Dự kiến** — **UC16.B02** (Luồng chính): Hệ thống hiển thị trạng thái từng tour: Nháp / Chờ AI / AI Warning / Chờ Admin duyệt / Đã duyệt / Bị từ chối / Đang bị ẩn.
- [ ] **Dự kiến** — **UC16.B03** (Luồng chính): Hệ thống hiển thị thông báo: tour bị khách báo cáo (kèm lý do) hoặc bị Admin từ chối/yêu cầu sửa (kèm lý do). A1, E1
- [ ] **Dự kiến** — **UC16.B04** (Luồng chính): Contributor mở một thông báo để xem chi tiết lý do.
- [ ] **Dự kiến** — **UC16.B05** (Luồng chính): Contributor chuyển sang sửa tour và gửi duyệt lại nếu cần. A2
- [ ] **Dự kiến** — **UC16.B06** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC16.A1** (Nhánh thay thế): Nhận thông báo đẩy (push) → khi tour đổi trạng thái (duyệt/từ chối/bị ẩn/bị báo cáo), hệ thống gửi thông báo cho contributor.
- [ ] **Dự kiến** — **UC16.A2** (Nhánh thay thế): Mở tour để sửa và gửi lại → hệ thống mở trình chỉnh sửa (UC10 / UC11); sau khi sửa, contributor gửi duyệt lại (UC15).
- [ ] **Dự kiến** — **UC16.E1** (Ngoại lệ/lỗi): Không có thông báo nào → danh sách trống.
- [ ] **Dự kiến** — **UC16.ASM01** (Giả định vận hành): Hệ thống thông báo hoạt động (in-app/push).
- [ ] **Dự kiến** — **UC16.PRE01** (Điều kiện trước): Contributor đã đăng nhập và có ít nhất một tour.
- [ ] **Dự kiến** — **UC16.POST01** (Kết quả sau): Contributor nắm được trạng thái và lý do; có thể chỉnh sửa và gửi lại.
- [ ] **Dự kiến** — **UC16.BR01** (Quy tắc nghiệp vụ): Thông báo luôn kèm lý do cụ thể (báo cáo / từ chối / yêu cầu sửa).
- [ ] **Dự kiến** — **UC16.BR02** (Quy tắc nghiệp vụ): Trạng thái tour phản ánh mô hình kiểm duyệt 3 tầng.
- [ ] **Dự kiến** — **UC16.BR03** (Quy tắc nghiệp vụ): Tour đạt ngưỡng báo cáo → "Chờ Admin xem lại" (liên quan UC06, UC20).

### UC17

- [ ] **Dự kiến** — **UC17.B01** (Luồng chính): Contributor chọn "Thống kê" của một tour.
- [ ] **Dự kiến** — **UC17.B02** (Luồng chính): Hệ thống hiển thị số liệu: lượt xem, lượt tải, lượt nghe/hoàn thành, điểm đánh giá trung bình, phân bố sao và danh sách nhận xét. E1
- [ ] **Dự kiến** — **UC17.B03** (Luồng chính): Contributor lọc theo thời gian hoặc ngôn ngữ. A1
- [ ] **Dự kiến** — **UC17.B04** (Luồng chính): Contributor đọc nhận xét để biết điểm cần cải thiện.
- [ ] **Dự kiến** — **UC17.B05** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC17.A1** (Nhánh thay thế): Lọc theo khoảng thời gian / ngôn ngữ → hệ thống hiển thị lại số liệu theo bộ lọc.
- [ ] **Dự kiến** — **UC17.E1** (Ngoại lệ/lỗi): Tour mới công khai chưa có dữ liệu → hiển thị "Chưa có dữ liệu thống kê".
- [ ] **Dự kiến** — **UC17.ASM01** (Giả định vận hành): Tour đã công khai và có người dùng tương tác.
- [ ] **Dự kiến** — **UC17.PRE01** (Điều kiện trước): Contributor đã đăng nhập; tour thuộc về contributor.
- [ ] **Dự kiến** — **UC17.POST01** (Kết quả sau): Contributor nắm được số liệu và phản hồi của tour.
- [ ] **Dự kiến** — **UC17.BR01** (Quy tắc nghiệp vụ): Thống kê dựa trên hành vi tourist (tải/nghe) và đánh giá (UC05).
- [ ] **Dự kiến** — **UC17.BR02** (Quy tắc nghiệp vụ): Contributor chỉ xem được thống kê các tour của chính mình.

### UC18

- [ ] **Dự kiến** — **UC18.B01** (Luồng chính): Contributor mở/cấu hình trang tác giả (ảnh đại diện, giới thiệu). A1
- [ ] **Dự kiến** — **UC18.B02** (Luồng chính): Hệ thống hiển thị trang tác giả công khai kèm danh sách các tour công khai của contributor. E1
- [ ] **Dự kiến** — **UC18.B03** (Luồng chính): Tourist truy cập trang tác giả (từ một tour hoặc từ tìm kiếm).
- [ ] **Dự kiến** — **UC18.B04** (Luồng chính): Tourist xem danh sách tour và theo dõi tác giả. A2
- [ ] **Dự kiến** — **UC18.B05** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC18.A1** (Nhánh thay thế): Chỉnh sửa thông tin trang tác giả → hệ thống lưu và cập nhật trang.
- [ ] **Dự kiến** — **UC18.A2** (Nhánh thay thế): Theo dõi / bỏ theo dõi tác giả → hệ thống cập nhật trạng thái theo dõi.
- [ ] **Dự kiến** — **UC18.E1** (Ngoại lệ/lỗi): Tác giả chưa có tour công khai → trang hiển thị trống.
- [ ] **Dự kiến** — **UC18.ASM01** (Giả định vận hành): Contributor có ít nhất một tour công khai (để trang có nội dung).
- [ ] **Dự kiến** — **UC18.PRE01** (Điều kiện trước): Contributor có tài khoản; trang tác giả được bật công khai.
- [ ] **Dự kiến** — **UC18.POST01** (Kết quả sau): Trang tác giả hiển thị các tour công khai; tourist có thể theo dõi.
- [ ] **Dự kiến** — **UC18.BR01** (Quy tắc nghiệp vụ): Chỉ hiển thị tour công khai (đã duyệt) trên trang tác giả.
- [ ] **Dự kiến** — **UC18.BR02** (Quy tắc nghiệp vụ): Theo dõi tác giả là tùy chọn (cần đăng nhập).

### UC19

- [ ] **Dự kiến** — **UC19.B01** (Luồng chính): Admin mở trang "Hàng chờ kiểm duyệt".
- [ ] **Dự kiến** — **UC19.B02** (Luồng chính): Hệ thống hiển thị danh sách tour chờ duyệt, sắp xếp theo thời gian gửi và ưu tiên tour có cờ AI Warning lên đầu. E1
- [ ] **Dự kiến** — **UC19.B03** (Luồng chính): Admin chọn một tour để xem chi tiết.
- [ ] **Dự kiến** — **UC19.B04** (Luồng chính): Hệ thống hiển thị chi tiết tour: ảnh, mô tả, các điểm, audio, vùng kích hoạt, kết quả AI check kèm lý do (nếu bị flag).
- [ ] **Dự kiến** — **UC19.B05** (Luồng chính): Admin preview tour như một khách thật (GPS giả lập, nghe audio, xem route). A1
- [ ] **Dự kiến** — **UC19.B06** (Luồng chính): Admin ra quyết định Duyệt. A2, A3
- [ ] **Dự kiến** — **UC19.B07** (Luồng chính): Hệ thống chuyển tour sang "Công khai"; tour xuất hiện trong tìm kiếm (UC02) và cho phép tải (UC03).
- [ ] **Dự kiến** — **UC19.B08** (Luồng chính): Hệ thống ghi log hành động và gửi thông báo cho contributor (UC16).
- [ ] **Dự kiến** — **UC19.B09** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC19.A1** (Nhánh thay thế): Preview tour → hệ thống chạy tour ở chế độ GPS giả lập cho Admin, quay về bước 6.
- [ ] **Dự kiến** — **UC19.A2** (Nhánh thay thế): Từ chối tour → Admin chọn lý do (danh sách có sẵn hoặc tự do); hệ thống chuyển tour sang "Bị từ chối", ghi log và thông báo contributor kèm lý do (UC16). Use case kết thúc.
- [ ] **Dự kiến** — **UC19.A3** (Nhánh thay thế): Yêu cầu chỉnh sửa (lỗi nhỏ) → hệ thống chuyển tour sang "Cần chỉnh sửa" và gửi yêu cầu cho contributor để sửa và gửi duyệt lại (UC15). Use case kết thúc.
- [ ] **Dự kiến** — **UC19.E1** (Ngoại lệ/lỗi): Không còn tour nào trong hàng chờ → hiển thị danh sách rỗng.
- [ ] **Dự kiến** — **UC19.ASM01** (Giả định vận hành): Chế độ preview GPS giả lập khả dụng.
- [ ] **Dự kiến** — **UC19.PRE01** (Điều kiện trước): Admin đã đăng nhập; có ít nhất một tour "Chờ Admin duyệt".
- [ ] **Dự kiến** — **UC19.POST01** (Kết quả sau): Tour chuyển sang Công khai / Bị từ chối / Cần chỉnh sửa; hành động được ghi log; contributor được thông báo.
- [ ] **Dự kiến** — **UC19.BR01** (Quy tắc nghiệp vụ): Đây là Tầng 2 của mô hình kiểm duyệt 3 tầng (Admin review).
- [ ] **Dự kiến** — **UC19.BR02** (Quy tắc nghiệp vụ): Tour có AI Warning ưu tiên lên đầu hàng chờ.
- [ ] **Dự kiến** — **UC19.BR03** (Quy tắc nghiệp vụ): Từ chối phải kèm lý do; mọi hành động được ghi log (UC22).
- [ ] **Dự kiến** — **UC19.BR04** (Quy tắc nghiệp vụ): Admin không tạo/sửa nội dung tour — chỉ quyết định trạng thái.
- [ ] **Dự kiến** — **UC19.BR05** (Quy tắc nghiệp vụ): Xem hàng chờ, xem chi tiết, preview là các action trong use case này (gộp A1–A5 của user story).

### UC20

- [ ] **Dự kiến** — **UC20.B01** (Luồng chính): Admin mở trang "Tour bị báo cáo".
- [ ] **Dự kiến** — **UC20.B02** (Luồng chính): Hệ thống hiển thị danh sách tour bị báo cáo, sắp xếp theo số lượt report giảm dần. E1
- [ ] **Dự kiến** — **UC20.B03** (Luồng chính): Admin chọn một tour để xem chi tiết các báo cáo (ai báo cáo, lý do, thời gian).
- [ ] **Dự kiến** — **UC20.B04** (Luồng chính): Admin xem lại nội dung tour / preview để đánh giá.
- [ ] **Dự kiến** — **UC20.B05** (Luồng chính): Admin ra quyết định: Ẩn tour. A1, A2, A3
- [ ] **Dự kiến** — **UC20.B06** (Luồng chính): Hệ thống chuyển tour sang "Đang bị ẩn", gửi cảnh báo cho contributor kèm lý do (UC16) và ghi log (UC22).
- [ ] **Dự kiến** — **UC20.B07** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC20.A1** (Nhánh thay thế): Khôi phục tour bị ẩn (báo cáo sai / report bomb) → hệ thống chuyển tour về "Công khai", ghi log.
- [ ] **Dự kiến** — **UC20.A2** (Nhánh thay thế): Bỏ qua báo cáo (không vi phạm) → hệ thống đóng báo cáo, giữ tour công khai, ghi log.
- [ ] **Dự kiến** — **UC20.A3** (Nhánh thay thế): Vi phạm nhiều lần → xử lý tài khoản → hệ thống chuyển sang UC21 – Quản lý tài khoản vi phạm.
- [ ] **Dự kiến** — **UC20.E1** (Ngoại lệ/lỗi): Không có tour bị báo cáo → danh sách rỗng.
- [ ] **Dự kiến** — **UC20.ASM01** (Giả định vận hành): Có dữ liệu báo cáo từ cộng đồng.
- [ ] **Dự kiến** — **UC20.PRE01** (Điều kiện trước): Admin đã đăng nhập; có tour bị báo cáo hoặc ở "Chờ Admin xem lại".
- [ ] **Dự kiến** — **UC20.POST01** (Kết quả sau): Tour được ẩn / khôi phục / giữ nguyên; hành động được ghi log; contributor được thông báo nếu bị ẩn.
- [ ] **Dự kiến** — **UC20.BR01** (Quy tắc nghiệp vụ): Phần xử lý của Tầng 3 – Community report.
- [ ] **Dự kiến** — **UC20.BR02** (Quy tắc nghiệp vụ): Tour nhận ≥ 5 báo cáo khác nhau trong 7 ngày tự chuyển "Chờ Admin xem lại" (UC06); không ẩn hẳn để Admin có thể khôi phục.
- [ ] **Dự kiến** — **UC20.BR03** (Quy tắc nghiệp vụ): Admin có thể khôi phục để bảo vệ contributor khỏi report bomb; mọi hành động ẩn/khôi phục được ghi log (UC22).
- [ ] **Dự kiến** — **UC20.BR04** (Quy tắc nghiệp vụ): Xem danh sách & chi tiết báo cáo là action trong use case này.

### UC21

- [ ] **Dự kiến** — **UC21.B01** (Luồng chính): Admin mở trang quản lý người dùng / hồ sơ một contributor.
- [ ] **Dự kiến** — **UC21.B02** (Luồng chính): Hệ thống hiển thị thông tin tài khoản và lịch sử vi phạm (tour bị ẩn/từ chối, số lượt report). E1
- [ ] **Dự kiến** — **UC21.B03** (Luồng chính): Admin chọn hành động: Cảnh báo / Tạm khóa / Ban. A1
- [ ] **Dự kiến** — **UC21.B04** (Luồng chính): Admin nhập lý do xử lý.
- [ ] **Dự kiến** — **UC21.B05** (Luồng chính): Hệ thống áp dụng (tạm khóa có thời hạn hoặc ban vĩnh viễn), ghi log (UC22) và thông báo cho người dùng.
- [ ] **Dự kiến** — **UC21.B06** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC21.A1** (Nhánh thay thế): Gỡ khóa / bỏ ban tài khoản → hệ thống khôi phục quyền truy cập và ghi log.
- [ ] **Dự kiến** — **UC21.E1** (Ngoại lệ/lỗi): Tài khoản không tồn tại → thông báo "Không tìm thấy tài khoản".
- [ ] **Dự kiến** — **UC21.ASM01** (Giả định vận hành): Có log lịch sử vi phạm của tài khoản.
- [ ] **Dự kiến** — **UC21.PRE01** (Điều kiện trước): Admin đã đăng nhập; tài khoản mục tiêu tồn tại.
- [ ] **Dự kiến** — **UC21.POST01** (Kết quả sau): Tài khoản bị tạm khóa/ban hoặc được gỡ khóa; hành động được ghi log; người dùng được thông báo.
- [ ] **Dự kiến** — **UC21.BR01** (Quy tắc nghiệp vụ): Quyết định ban dựa trên lịch sử vi phạm (log).
- [ ] **Dự kiến** — **UC21.BR02** (Quy tắc nghiệp vụ): Tài khoản bị ban không thể đăng nhập (UC01 – Exception E3).
- [ ] **Dự kiến** — **UC21.BR03** (Quy tắc nghiệp vụ): Mọi hành động khóa/ban/gỡ được ghi log (UC22).

### UC22

- [ ] **Dự kiến** — **UC22.B01** (Luồng chính): Admin mở "Dashboard".
- [ ] **Dự kiến** — **UC22.B02** (Luồng chính): Hệ thống hiển thị các chỉ số: số tour đang chờ duyệt, thời gian xử lý trung bình, số tour bị report trong tuần, top contributor theo chất lượng. A1, E1
- [ ] **Dự kiến** — **UC22.B03** (Luồng chính): Admin mở mục "Nhật ký hành động".
- [ ] **Dự kiến** — **UC22.B04** (Luồng chính): Hệ thống hiển thị log: ai duyệt tour nào, ai ban user nào, vào lúc nào.
- [ ] **Dự kiến** — **UC22.B05** (Luồng chính): Admin lọc log theo admin / thời gian / loại hành động. A2
- [ ] **Dự kiến** — **UC22.B06** (Luồng chính): Use case kết thúc tại đây.
- [ ] **Dự kiến** — **UC22.A1** (Nhánh thay thế): Lọc dashboard theo khoảng thời gian → hệ thống hiển thị lại số liệu theo khoảng thời gian.
- [ ] **Dự kiến** — **UC22.A2** (Nhánh thay thế): Tìm/lọc log → hệ thống hiển thị các bản ghi log khớp.
- [ ] **Dự kiến** — **UC22.E1** (Ngoại lệ/lỗi): Chưa có dữ liệu → hiển thị dashboard trống.
- [ ] **Dự kiến** — **UC22.ASM01** (Giả định vận hành): Hệ thống có ghi log hành động và thu thập số liệu.
- [ ] **Dự kiến** — **UC22.PRE01** (Điều kiện trước): Admin đã đăng nhập.
- [ ] **Dự kiến** — **UC22.POST01** (Kết quả sau): Admin nắm được tình hình vận hành và lịch sử hành động của các admin.
- [ ] **Dự kiến** — **UC22.BR01** (Quy tắc nghiệp vụ): Log hành động là bản ghi bất biến (audit trail) để minh bạch vận hành.
- [ ] **Dự kiến** — **UC22.BR02** (Quy tắc nghiệp vụ): Dashboard phục vụ quản lý khối lượng công việc kiểm duyệt.
