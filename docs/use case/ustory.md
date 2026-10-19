# User Story – Hệ thống audio guide du lịch (tham khảo izi.travel)

## Actor 1: Khách du lịch (Tourist)

### Epic A. Khám phá tour


| ID  | User story                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Là khách du lịch, tôi muốn tìm tour theo thành phố hoặc từ khóa để chọn được tour phù hợp nơi tôi đến.                                                                                                                                                         |
| T2  | Là khách du lịch, tôi muốn xem chi tiết tour (ảnh bìa, mô tả, số điểm dừng, route trên bản đồ, thời lượng) để quyết định có đi hay không.                                                                                                                      |
| T3  | Là khách du lịch, tôi muốn xem đánh giá và nhận xét của người đã nghe để biết tour có đáng đi không.                                                                                                                                                           |
| T4  | Là khách du lịch, tôi muốn chọn ngôn ngữ nghe tour; nếu tour có audio người thật đúng ngôn ngữ thì phát audio đó, nếu không thì hệ thống tự dịch text và dùng TTS (text-to-speech) phát theo ngôn ngữ tôi chọn, để tôi luôn nghe được bằng ngôn ngữ mình hiểu. |
| T24 | Là khách du lịch, tôi muốn thấy nhãn phân biệt "giọng người thật" hay "giọng máy (TTS)" trên từng tour/điểm, để biết trước chất lượng audio mình sắp nghe.                                                                                                     |




### Epic B. Tải tour


| ID  | User story                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T5  | Là khách du lịch, tôi muốn tải tour (text, ảnh, bản đồ, audio người thật nếu có, hoặc audio TTS được render sẵn theo ngôn ngữ tôi chọn) về máy trước chuyến đi, lúc có Wi-Fi, để khỏi tốn thời gian và data khi đang đi. |
| T6  | Là khách du lịch, tôi muốn xem danh sách và xóa các tour đã tải để quản lý dung lượng máy.                                                                                                                               |




### Epic C. Đi tour và nghe audio


| ID  | User story                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T7  | Là khách du lịch, tôi muốn bắt đầu tour và thấy vị trí GPS của mình cùng các điểm dừng và route trên bản đồ để biết mình đang ở đâu.                                                                         |
| T8  | Là khách du lịch, tôi muốn audio tự phát khi tôi bước vào vùng kích hoạt (trigger zone) của một điểm để nghe giới thiệu mà không cần thao tác.                                                               |
| T9  | Là khách du lịch, tôi muốn nghe audio chỉ đường (navigation hint) tự phát khi tôi vào vùng chỉ đường để biết đi tiếp đến điểm nào mà không phải nhìn điện thoại liên tục.                                    |
| T10 | Là khách du lịch, tôi muốn phát, tạm dừng, tua audio, và chuyển điểm trước hoặc sau để nghe theo nhịp của mình.                                                                                              |
| T11 | Là khách du lịch, tôi muốn xem text và ảnh của điểm đang nghe để hiểu rõ hơn nội dung.                                                                                                                       |
| T12 | Là khách du lịch, tôi muốn tour đã tải vẫn hoạt động đầy đủ (GPS, audio tự phát) khi không có mạng.                                                                                                          |
| T13 | Là khách du lịch, tôi muốn đánh giá và nhận xét tour sau khi đi xong để giúp người khác chọn tour.                                                                                                           |
| T23 | Là khách du lịch, tôi muốn báo cáo tour có nội dung sai lệch, phản cảm hoặc spam bằng cách chọn lý do từ danh sách (sai sự thật / phản cảm / spam / vi phạm bản quyền / khác) để giúp cộng đồng được bảo vệ. |




### Mở rộng (tùy chọn)


| ID  | User story                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ |
| T14 | Là khách du lịch, tôi muốn nghe thử tour từ xa (không cần GPS, chọn điểm thủ công) để xem trước khi đến nơi. |
| T15 | Là khách du lịch, tôi muốn đăng ký và đăng nhập để đồng bộ tour đã tải và đánh giá của mình.                 |



| ID  | User story                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| T16 | Là khách du lịch, tôi muốn xem và tìm từng địa điểm riêng lẻ (không phụ thuộc tour) để chọn những nơi mình quan tâm.                       |
| T17 | Là khách du lịch, tôi muốn tạo lịch trình cá nhân, đặt tên và thêm các địa điểm mình chọn để lên kế hoạch chuyến đi.                       |
| T18 | Là khách du lịch, tôi muốn sắp xếp thứ tự, thêm và xóa địa điểm trong lịch trình để điều chỉnh theo thời gian của mình.                    |
| T19 | Là khách du lịch, tôi muốn xem lịch trình trên bản đồ cùng khoảng cách và thời gian di chuyển ước tính để biết chuyến đi có khả thi không. |
| T20 | Là khách du lịch, tôi muốn tải lịch trình cá nhân về máy để dùng offline.                                                                  |
| T21 | Là khách du lịch, tôi muốn đi theo lịch trình của mình và nghe audio tự phát khi đến gần từng điểm (giống như đi một tour thường).         |
| T22 | Là khách du lịch, tôi muốn chia sẻ lịch trình cho bạn bè (tùy chọn) để cùng đi.                                                            |


---



## Actor 2: Người đăng nội dung (Contributor)



### Epic D. Tài khoản


| ID  | User story                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| C1  | Là người đăng nội dung, tôi muốn đăng ký và đăng nhập tài khoản để vào trang quản lý nội dung của mình.                    |
| C2  | Là người đăng nội dung, tôi muốn có trang tác giả hiển thị các tour công khai của mình để người dùng biết và theo dõi tôi. |




### Epic E. Tạo tour


| ID  | User story                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------- |
| C3  | Là người đăng nội dung, tôi muốn tạo tour mới (tên, mô tả ngắn, ảnh bìa, ngôn ngữ) để giới thiệu tour với khách.                |
| C4  | Là người đăng nội dung, tôi muốn xem danh sách các tour của mình kèm trạng thái (nháp, truy cập hạn chế, công khai) để quản lý. |
| C5  | Là người đăng nội dung, tôi muốn sửa hoặc xóa tour của mình, kể cả sau khi đã công khai, để giữ nội dung luôn chính xác.        |




### Epic F. Thêm địa điểm lên bản đồ


| ID  | User story                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C6  | Là người đăng nội dung, tôi muốn thêm điểm lên bản đồ bằng cách tìm địa chỉ để định vị nhanh và chính xác.                                                                                                      |
| C7  | Là người đăng nội dung, tôi muốn thả pin thủ công lên bản đồ để thêm những điểm không tìm được bằng địa chỉ.                                                                                                    |
| C8a | Là người đăng nội dung, tôi muốn gắn cho mỗi điểm **tên, loại địa điểm (di tích, bảo tàng, nhà hàng,...), mô tả text (bắt buộc)** và nhiều ảnh có chú thích, để khách có đủ nội dung khi đến nơi.               |
| C8b | Là người đăng nội dung, tôi **có thể tùy chọn** upload file audio người thật cho từng điểm; nếu không upload, hệ thống sẽ dùng TTS đọc text để làm audio, để tôi tạo tour nhanh mà vẫn có audio phát cho khách. |
| C9  | Là người đăng nội dung, tôi muốn sắp xếp lại thứ tự các điểm và xóa điểm để route hợp lý.                                                                                                                       |




### Epic G. Route và kích hoạt audio


| ID  | User story                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| C10 | Là người đăng nội dung, tôi muốn vẽ đường route nối các điểm để khách biết đường đi.                                                                 |
| C11 | Là người đăng nội dung, tôi muốn đặt vùng kích hoạt (hình tròn hoặc đa giác, chỉnh được bán kính) cho mỗi điểm để audio phát đúng lúc khách đến gần. |
| C12 | Là người đăng nội dung, tôi muốn đặt độ ưu tiên khi các vùng kích hoạt chồng lên nhau để hệ thống phát đúng audio cần nghe.                          |
| C13 | Là người đăng nội dung, tôi muốn thêm audio chỉ đường với vùng kích hoạt riêng (ví dụ ở ngã rẽ) để khách không đi lạc.                               |
| C14 | Là người đăng nội dung, tôi muốn thêm gợi ý "đi tiếp đến đâu" phát ngay sau khi khách nghe xong một điểm để dẫn khách sang điểm kế tiếp.             |




### Epic H. Kiểm thử và xuất bản


| ID  | User story                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C15 | Là người đăng nội dung, tôi muốn xem thử tour trong app như một khách thật để kiểm tra trước khi công khai.                             |
| C16 | Là người đăng nội dung, tôi muốn để tour ở chế độ truy cập hạn chế (chỉ ai nhập mã passcode mới thấy) để test mà công chúng chưa thấy.  |
| C17 | Là người đăng nội dung, tôi muốn gửi tour đi duyệt để sau khi được Admin phê duyệt, tour sẽ công khai cho mọi người tìm thấy và tải về. |
| C18 | Là người đăng nội dung, tôi muốn xem thống kê và đánh giá của tour để cải thiện nội dung.                                               |




### Epic I. Kiểm duyệt nội dung tự động (AI moderation)


| ID  | User story                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C19 | Là người đăng nội dung, khi tôi upload ảnh (ảnh bìa tour, ảnh điểm), hệ thống tự động quét ảnh phản cảm (NSFW) ngay tại trình duyệt và từ chối upload nếu phát hiện vi phạm, để tôi biết ngay thay vì chờ sau khi publish.                                                  |
| C20 | Là người đăng nội dung, khi tôi thả pin hoặc vẽ vùng kích hoạt, hệ thống cảnh báo nếu điểm nằm trong vùng cấm (khu quân sự, trường học, bệnh viện, lãnh sự quán) để tôi điều chỉnh vị trí hợp lý.                                                                           |
| C21 | Là người đăng nội dung, khi tôi nhấn "Gửi duyệt" tour, hệ thống tự động kiểm duyệt phần text (tiêu đề, mô tả tour, mô tả các điểm) bằng AI và hiển thị kết quả Pass / Warning / Reject kèm lý do cụ thể, để tôi sửa trước khi tour được chuyển sang hàng chờ Admin xem xét. |
| C22 | Là người đăng nội dung, tôi muốn nhận thông báo khi tour của mình bị khách báo cáo (kèm lý do báo cáo) hoặc bị Admin từ chối (kèm lý do), để kiểm tra và chỉnh sửa kịp thời.                                                                                                |
| C23 | Là người đăng nội dung, tôi muốn xem trạng thái tour của mình trong luồng kiểm duyệt (Nháp / Chờ AI / AI Warning / Chờ Admin duyệt / Đã duyệt / Bị từ chối / Đang bị ẩn), để biết tour đang ở bước nào và cần làm gì tiếp theo.                                             |




### Epic M. Đa ngôn ngữ và TTS


| ID  | User story                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C24 | Là người đăng nội dung, tôi muốn chọn **ngôn ngữ gốc** của text và các **ngôn ngữ phụ** mà hệ thống sẽ tự động dịch + TTS, để tour của tôi phục vụ được khách quốc tế mà không phải tự thu nhiều audio. |
| C25 | Là người đăng nội dung, tôi muốn nghe thử bản TTS của từng điểm theo từng ngôn ngữ và chỉnh lại text (hoặc chỉnh bản dịch) nếu nghe sai tên riêng/thuật ngữ, để đảm bảo chất lượng trước khi gửi duyệt. |
| C26 | Là người đăng nội dung, tôi muốn chọn giọng đọc TTS (nam/nữ, vùng miền) cho tour của mình, để giọng audio phù hợp với chủ đề tour.                                                                      |


---



## Actor 3: Admin (Quản trị viên kiểm duyệt)



### Epic J. Quản lý hàng chờ kiểm duyệt


| ID  | User story                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Là admin, tôi muốn xem danh sách tour đang chờ duyệt (sắp xếp theo thời gian gửi, ưu tiên tour có AI Warning), để xử lý theo thứ tự hợp lý.                            |
| A2  | Là admin, tôi muốn xem chi tiết tour trong hàng chờ (ảnh, mô tả, các điểm, audio, vùng kích hoạt, kết quả AI check kèm lý do nếu bị flag) để có đủ thông tin đánh giá. |
| A3  | Là admin, tôi muốn preview tour trong app như một khách thật (chạy thử GPS giả lập, nghe audio, xem route) để kiểm tra trải nghiệm thực tế trước khi duyệt.            |
| A4  | Là admin, tôi muốn duyệt hoặc từ chối tour kèm lý do từ chối (chọn từ danh sách lý do có sẵn hoặc viết tự do), để contributor biết chính xác cần sửa gì.               |
| A5  | Là admin, tôi muốn yêu cầu contributor chỉnh sửa và gửi duyệt lại (thay vì từ chối hẳn) khi tour chỉ có lỗi nhỏ, để tiết kiệm thời gian cho cả hai bên.                |




### Epic K. Xử lý báo cáo và vi phạm


| ID  | User story                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A6  | Là admin, tôi muốn xem danh sách tour bị khách báo cáo, sắp xếp theo số lượt report giảm dần, để ưu tiên xử lý tour có nhiều vấn đề nhất. |
| A7  | Là admin, tôi muốn xem chi tiết các báo cáo của một tour (ai báo cáo, lý do, thời gian) để hiểu rõ vấn đề trước khi quyết định.           |
| A8  | Là admin, tôi muốn ẩn tour vi phạm và gửi cảnh báo cho contributor (kèm lý do) để duy trì chất lượng cộng đồng.                           |
| A9  | Là admin, tôi muốn khôi phục tour bị ẩn khi phát hiện báo cáo là sai (ví dụ: bị report bomb), để bảo vệ contributor khỏi bị oan.          |
| A10 | Là admin, tôi muốn tạm khóa hoặc ban hẳn tài khoản contributor vi phạm nhiều lần (có log lịch sử vi phạm) để chống tái phạm.              |




### Epic L. Thống kê và giám sát


| ID  | User story                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11 | Là admin, tôi muốn xem dashboard thống kê (số tour đang chờ duyệt, thời gian xử lý trung bình, số tour bị report trong tuần, top contributor theo chất lượng) để quản lý khối lượng công việc. |
| A12 | Là admin, tôi muốn xem log các hành động của mình và các admin khác (ai duyệt tour nào, ai ban user nào, lúc nào) để minh bạch trong vận hành.                                                 |


---



## Quyết định về phạm vi

- Đã bỏ: quest, dự án cho trẻ em, dự án hòa nhập (inclusive), tài trợ (sponsors), vì ngoài mô tả 3 actor.
- Chỉ lấy street tour (có map và GPS), bỏ chế độ museum không dùng GPS. T14 là phần còn lại của chế độ museum.
- **Text là nội dung bắt buộc; audio là tùy chọn**:
  - Contributor **bắt buộc** nhập text mô tả cho mỗi điểm (đây là nguồn nội dung chính thức, được dùng cho kiểm duyệt AI và cho hiển thị cùng audio).
  - Contributor **có thể (optional)** upload file audio người thật, mỗi điểm một file, cho ngôn ngữ gốc.
  - Với các ngôn ngữ còn lại (hoặc khi contributor không upload audio người thật): hệ thống tự **dịch text** sang ngôn ngữ tourist chọn và dùng **TTS (text-to-speech)** để phát audio.
  - Khi phát: nếu có audio người thật đúng ngôn ngữ → ưu tiên phát audio người thật; nếu không → phát TTS.
  - Tour/điểm có nhãn hiển thị "giọng người thật" hay "giọng máy (TTS)" (T24) để tourist biết trước.
  - Audio TTS được **pre-render và cache khi tourist tải tour** (T5) để chạy được offline (T12).
- Chỉ tác giả tạo tour, khách không tự tạo.
- Hệ thống có **3 actor**: Tourist, Contributor, Admin.
- Kiểm duyệt nội dung theo mô hình **3 tầng (hybrid: AI + Admin + Community)**:
  - **Tầng 1 — AI tự động** (khi contributor nhấn Gửi duyệt): quét text bằng Gemini API, quét ảnh bằng NSFW.js (client-side), kiểm GPS so với danh sách vùng cấm bằng turf.js. Kết quả: Pass / Warning / Reject.
    - **Reject**: trả về contributor sửa ngay, không vào hàng chờ Admin.
    - **Pass / Warning**: chuyển sang Tầng 2.
  - **Tầng 2 — Admin review** (Epic J): Admin xem tour trong hàng chờ, preview, duyệt hoặc từ chối kèm lý do. Tour có AI Warning được ưu tiên lên đầu hàng chờ.
  - **Tầng 3 — Community report** (T23, Epic K): sau khi tour đã công khai, khách có thể báo cáo. Tour nhận ≥ 5 báo cáo khác nhau trong 7 ngày sẽ **tự động chuyển về trạng thái "Chờ Admin xem lại"** (không ẩn hẳn, để Admin có cơ hội khôi phục nếu là report sai).
- Chế độ truy cập hạn chế bằng passcode (C16) vẫn giữ, dùng cho mục đích test riêng với nhóm nhỏ (không cần qua Admin duyệt vì không công khai).
- Admin không tạo tour, không tham gia nội dung — chỉ kiểm duyệt và quản lý vi phạm.
- Vùng kích hoạt do tác giả tự đặt, dạng tròn hoặc đa giác.
- Khách không bắt buộc đăng nhập (T15 là mở rộng).

