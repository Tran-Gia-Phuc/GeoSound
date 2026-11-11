// =========================================================
// #349 — data for the bulk dev seed: real points of interest in the 13 cities the chatbot knows
// (CITY_ALIASES in services/ai/app/chatbot/graph/rules.py), and catalogTours() that builds many
// demo tours from them (one per theme / variant / city). Used by seed-tours.js. NOT for production.
// Deterministic: same catalog -> same tours in the same order, so the fixed ids stay stable.
// Only APPEND to a city list, or the tours after it get other places on the next run.
// =========================================================

// Place = [name, type, lat, lng, description]. Coordinates are approximate (demo data).
export const CATALOG = {
  'Hà Nội': [
    ['Hồ Hoàn Kiếm', 'nature', 21.0288, 105.8522, 'Hồ Gươm giữa trung tâm Hà Nội gắn với truyền thuyết vua Lê Lợi trả gươm cho Rùa Vàng; Tháp Rùa nằm giữa hồ.'],
    ['Đền Ngọc Sơn', 'historical', 21.0307, 105.8524, 'Ngôi đền trên đảo Ngọc ở hồ Hoàn Kiếm, đi qua cầu Thê Húc sơn đỏ, thờ Đức Thánh Trần Hưng Đạo và Văn Xương Đế Quân.'],
    ['Nhà thờ Lớn Hà Nội', 'landmark', 21.0287, 105.8489, 'Nhà thờ Thánh Giuse xây năm 1886 theo phong cách Gothic, mặt tiền đá xám với hai tháp chuông cao.'],
    ['Chợ Đồng Xuân', 'shopping', 21.0382, 105.8497, 'Chợ đầu mối lớn nhất phố cổ, bán vải vóc, đồ khô và có khu ẩm thực bình dân ở tầng trệt.'],
    ['Nhà tù Hỏa Lò', 'historical', 21.0253, 105.8464, 'Nhà tù do Pháp xây cuối thế kỷ XIX, nay là di tích kể về những người tù chính trị Việt Nam.'],
    ['Nhà hát Lớn Hà Nội', 'landmark', 21.0245, 105.8576, 'Nhà hát kiến trúc Pháp khánh thành năm 1911, nơi diễn ra nhiều buổi hòa nhạc và vở opera.'],
    ['Bảo tàng Lịch sử Quốc gia', 'museum', 21.0246, 105.86, 'Bảo tàng trưng bày hiện vật từ thời tiền sử đến cận đại, nổi bật là trống đồng Đông Sơn.'],
    ['Chùa Trấn Quốc', 'historical', 21.048, 105.8368, 'Ngôi chùa cổ gần 1500 năm tuổi trên bán đảo nhỏ ở Hồ Tây, có bảo tháp 11 tầng.'],
    ['Hồ Tây', 'nature', 21.0545, 105.826, 'Hồ nước lớn nhất nội thành, đường ven hồ hợp để đạp xe và ngắm hoàng hôn.'],
    ['Phố bia Tạ Hiện', 'entertainment', 21.035, 105.8517, 'Ngã tư bia hơi sôi động nhất phố cổ, buổi tối kín ghế nhựa và khách du lịch.'],
    ['Phở Bát Đàn', 'food', 21.0337, 105.8467, 'Quán phở bò gia truyền nổi tiếng với nước dùng trong, khách xếp hàng tự bưng bát.'],
    ['Bún chả Hương Liên', 'food', 21.0177, 105.8536, 'Quán bún chả lâu năm trên phố Lê Văn Hưu, chả nướng than hoa ăn kèm nước chấm chua ngọt.'],
    ['Bảo tàng Mỹ thuật Việt Nam', 'museum', 21.0307, 105.837, 'Bảo tàng lưu giữ tranh sơn mài, lụa, tượng Phật cổ và mỹ thuật dân gian Việt Nam.'],
    ['Chợ đêm phố cổ Hàng Ngang', 'shopping', 21.0355, 105.8502, 'Chợ đêm cuối tuần trên trục Hàng Đào - Hàng Ngang bán quần áo, quà lưu niệm và đồ ăn vặt.'],
    ['Cà phê Giảng', 'food', 21.0332, 105.8541, 'Nơi khai sinh cà phê trứng Hà Nội từ năm 1946, lòng đỏ trứng đánh bông phủ trên cà phê đậm.'],
  ],
  'Hồ Chí Minh': [
    ['Nhà thờ Đức Bà Sài Gòn', 'landmark', 10.7798, 106.699, 'Vương cung thánh đường xây bằng gạch đỏ chở từ Pháp sang, hoàn thành năm 1880.'],
    ['Bưu điện Trung tâm Sài Gòn', 'landmark', 10.78, 106.7, 'Công trình kiến trúc Pháp cuối thế kỷ XIX với mái vòm sắt và bản đồ Sài Gòn xưa vẽ trên tường.'],
    ['Dinh Độc Lập', 'historical', 10.777, 106.6953, 'Dinh thự gắn với sự kiện ngày 30 tháng 4 năm 1975, giữ nguyên phòng họp, hầm chỉ huy và xe tăng.'],
    ['Bảo tàng Chứng tích Chiến tranh', 'museum', 10.7795, 106.6921, 'Bảo tàng trưng bày ảnh và hiện vật về hậu quả chiến tranh tại Việt Nam.'],
    ['Phố đi bộ Nguyễn Huệ', 'entertainment', 10.774, 106.7038, 'Quảng trường đi bộ trước Ủy ban Nhân dân thành phố, tối đến có nhạc nước và nghệ sĩ đường phố.'],
    ['Chợ Bến Thành', 'shopping', 10.7725, 106.698, 'Chợ hơn trăm năm tuổi, biểu tượng của Sài Gòn, bán vải, đồ lưu niệm và đặc sản.'],
    ['Bảo tàng Mỹ thuật TP.HCM', 'museum', 10.7697, 106.699, 'Tòa nhà cổ của một thương gia người Hoa, nay trưng bày mỹ thuật Việt Nam hiện đại và cổ.'],
    ['Chùa Ngọc Hoàng', 'historical', 10.7922, 106.6983, 'Ngôi chùa Đạo giáo đầu thế kỷ XX với nhiều tượng gỗ chạm khắc và khói hương nghi ngút.'],
    ['Chợ Bình Tây', 'shopping', 10.7497, 106.651, 'Chợ sỉ lớn nhất Chợ Lớn, kiến trúc mái ngói Hoa có tháp đồng hồ ở giữa sân.'],
    ['Công viên Tao Đàn', 'nature', 10.7745, 106.6927, 'Công viên cây cổ thụ giữa quận 1, buổi sáng có người tập thể dục và hội chim cảnh.'],
    ['Thảo Cầm Viên Sài Gòn', 'nature', 10.7875, 106.7053, 'Vườn thú và vườn thực vật lâu đời nhất Việt Nam, mở cửa từ năm 1864.'],
    ['Đường sách Nguyễn Văn Bình', 'shopping', 10.7807, 106.6995, 'Con đường sách rợp bóng cây cạnh Bưu điện Thành phố, có quầy sách và quán cà phê.'],
    ['Bánh mì Huỳnh Hoa', 'food', 10.7712, 106.6923, 'Tiệm bánh mì nổi tiếng với ổ bánh dày pa tê, chả lụa và thịt nguội.'],
    ['Phở Hòa Pasteur', 'food', 10.7889, 106.689, 'Quán phở lâu đời của Sài Gòn, bát phở to ăn kèm rau thơm, giá đỗ và quẩy.'],
    ['Cơm tấm Ba Ghiền', 'food', 10.7975, 106.6795, 'Quán cơm tấm sườn nướng miếng to nổi tiếng ở Phú Nhuận.'],
    ['Landmark 81', 'landmark', 10.795, 106.7218, 'Tòa nhà cao nhất Việt Nam bên sông Sài Gòn, có đài quan sát trên tầng cao.'],
    ['Hội quán Thiên Hậu', 'historical', 10.753, 106.661, 'Hội quán của người Hoa ở Chợ Lớn thờ Bà Thiên Hậu, mái chạm gốm sứ rực rỡ.'],
  ],
  'Hội An': [
    ['Chùa Cầu', 'historical', 15.8772, 108.326, 'Cây cầu gỗ có mái do thương nhân Nhật xây thế kỷ XVII, biểu tượng của phố cổ Hội An.'],
    ['Nhà cổ Tấn Ký', 'historical', 15.8768, 108.3283, 'Ngôi nhà gỗ hơn 200 năm của một gia đình thương nhân, kết hợp kiến trúc Việt, Hoa và Nhật.'],
    ['Hội quán Phúc Kiến', 'historical', 15.878, 108.3306, 'Hội quán lớn nhất Hội An của người Hoa Phúc Kiến, thờ Thiên Hậu Thánh Mẫu.'],
    ['Chợ đêm Nguyễn Hoàng', 'shopping', 15.8755, 108.3265, 'Chợ đêm bên sông Hoài bán đèn lồng, quà lưu niệm và đồ ăn vặt.'],
    ['Bánh mì Phượng', 'food', 15.8796, 108.3311, 'Tiệm bánh mì Hội An nổi tiếng với nhiều loại nhân và nước sốt riêng.'],
    ['Cơm gà Bà Buội', 'food', 15.88, 108.3297, 'Quán cơm gà xé lâu năm, cơm nấu nước luộc gà vàng óng ăn kèm rau răm.'],
    ['Biển An Bàng', 'nature', 15.914, 108.342, 'Bãi biển cát trắng cách phố cổ vài cây số, nước trong và yên tĩnh.'],
    ['Biển Cửa Đại', 'nature', 15.896, 108.37, 'Bãi biển dài gần cửa sông Thu Bồn, có nhiều hàng hải sản ven biển.'],
    ['Làng gốm Thanh Hà', 'shopping', 15.878, 108.302, 'Làng gốm 500 năm tuổi, du khách có thể tự nặn gốm bên bàn xoay.'],
    ['Bảo tàng Văn hóa Sa Huỳnh', 'museum', 15.8769, 108.3256, 'Bảo tàng nhỏ trưng bày mộ chum và đồ gốm của nền văn hóa Sa Huỳnh hơn 2000 năm trước.'],
    ['Rừng dừa Bảy Mẫu', 'nature', 15.864, 108.363, 'Rừng dừa nước ở Cẩm Thanh, du khách đi thuyền thúng và xem múa thúng.'],
    ['Phố Nguyễn Thái Học', 'landmark', 15.8763, 108.329, 'Con phố cổ treo đầy đèn lồng, đẹp nhất vào đêm rằm khi phố tắt đèn điện.'],
  ],
  'Huế': [
    ['Đại Nội Huế', 'historical', 16.4698, 107.5786, 'Hoàng thành của triều Nguyễn với Ngọ Môn, điện Thái Hòa và Tử Cấm Thành, di sản UNESCO.'],
    ['Chùa Thiên Mụ', 'historical', 16.4537, 107.545, 'Ngôi chùa bên sông Hương có tháp Phước Duyên bảy tầng, xây từ năm 1601.'],
    ['Lăng Tự Đức', 'historical', 16.4333, 107.565, 'Lăng vua Tự Đức giữa rừng thông và hồ sen, nơi nhà vua làm thơ lúc sinh thời.'],
    ['Lăng Khải Định', 'historical', 16.399, 107.5905, 'Lăng kết hợp kiến trúc Đông Tây, nội thất khảm sành sứ và thủy tinh cầu kỳ.'],
    ['Lăng Minh Mạng', 'historical', 16.387, 107.57, 'Lăng bố cục đối xứng trên một trục dài, bao quanh bởi hồ nước và đồi thông.'],
    ['Chợ Đông Ba', 'shopping', 16.4729, 107.588, 'Chợ lớn nhất Huế bên sông Hương, bán nón lá, mè xửng và các món bánh Huế.'],
    ['Cầu Trường Tiền', 'landmark', 16.469, 107.589, 'Cây cầu sáu vài mười hai nhịp bắc qua sông Hương, lên đèn đổi màu vào buổi tối.'],
    ['Bảo tàng Cổ vật Cung đình Huế', 'museum', 16.4678, 107.5822, 'Điện Long An bằng gỗ trưng bày đồ ngự dụng, trang phục và đồ sứ của triều Nguyễn.'],
    ['Phố đi bộ Nguyễn Đình Chiểu', 'entertainment', 16.468, 107.5905, 'Con phố ven bờ nam sông Hương, tối có hàng ăn và thuyền nghe ca Huế.'],
    ['Chè Hẻm Hùng Vương', 'food', 16.463, 107.598, 'Quán chè trong hẻm nhỏ với hàng chục loại chè Huế ngọt thanh.'],
    ['Đồi Vọng Cảnh', 'nature', 16.44, 107.56, 'Ngọn đồi nhìn xuống khúc quanh sông Hương, nơi ngắm hoàng hôn đẹp ở Huế.'],
    ['Nhà vườn An Hiên', 'historical', 16.462, 107.556, 'Nhà rường cổ giữa khu vườn cây trái, tiêu biểu cho nhà vườn xứ Huế.'],
  ],
  'Đà Nẵng': [
    ['Cầu Rồng', 'landmark', 16.0612, 108.2272, 'Cây cầu hình rồng bắc qua sông Hàn, tối cuối tuần rồng phun lửa và phun nước.'],
    ['Biển Mỹ Khê', 'nature', 16.06, 108.247, 'Bãi biển cát mịn dài nhiều cây số, sáng sớm người dân ra tắm biển và tập thể dục.'],
    ['Ngũ Hành Sơn', 'nature', 16.004, 108.263, 'Năm ngọn núi đá vôi với hang động, chùa chiền và làng nghề đá mỹ nghệ Non Nước.'],
    ['Chùa Linh Ứng Sơn Trà', 'historical', 16.1, 108.277, 'Ngôi chùa trên bán đảo Sơn Trà có tượng Phật Quan Âm cao 67 mét nhìn ra biển.'],
    ['Bán đảo Sơn Trà', 'nature', 16.12, 108.278, 'Khu rừng nguyên sinh sát thành phố, nơi sống của loài voọc chà vá chân nâu.'],
    ['Bảo tàng Điêu khắc Chăm', 'museum', 16.0603, 108.2235, 'Bảo tàng lưu giữ bộ sưu tập tượng đá Chăm Pa lớn nhất thế giới.'],
    ['Chợ Hàn', 'shopping', 16.068, 108.224, 'Chợ trung tâm bên sông Hàn, nơi mua mực khô, mắm và đặc sản miền Trung.'],
    ['Nhà thờ Chính tòa Đà Nẵng', 'landmark', 16.0667, 108.2232, 'Nhà thờ màu hồng xây năm 1923, người dân gọi là nhà thờ Con Gà vì chong chóng trên tháp.'],
    ['Chợ Cồn', 'food', 16.068, 108.214, 'Chợ nổi tiếng với khu ăn vặt: bánh xèo, bún mắm, gỏi cuốn và chè.'],
    ['Mì Quảng Bà Mua', 'food', 16.07, 108.219, 'Quán mì Quảng lâu năm với nhiều loại nhân tôm, thịt, gà và cá lóc.'],
    ['Cầu Tình Yêu', 'entertainment', 16.063, 108.23, 'Cây cầu đi bộ ven sông Hàn treo khóa tình yêu, cạnh tượng cá chép hóa rồng.'],
    ['Bảo tàng Đà Nẵng', 'museum', 16.077, 108.221, 'Bảo tàng về thiên nhiên, lịch sử và văn hóa Đà Nẵng nằm trong thành Điện Hải.'],
    ['Chợ đêm Sơn Trà', 'food', 16.064, 108.231, 'Chợ đêm gần cầu Rồng với hàng nướng, hải sản và quần áo giá rẻ.'],
  ],
  'Nha Trang': [
    ['Tháp Bà Ponagar', 'historical', 12.2655, 109.1953, 'Quần thể tháp Chăm thế kỷ VIII đến XIII thờ nữ thần Po Nagar, nằm trên đồi bên sông Cái.'],
    ['Nhà thờ Núi Nha Trang', 'landmark', 12.246, 109.188, 'Nhà thờ đá kiểu Gothic trên một ngọn đồi nhỏ giữa thành phố, xây năm 1928.'],
    ['Chùa Long Sơn', 'historical', 12.25, 109.18, 'Ngôi chùa có tượng Phật trắng ngồi trên đỉnh đồi Trại Thủy nhìn ra thành phố.'],
    ['Chợ Đầm', 'shopping', 12.255, 109.192, 'Chợ lớn hình tròn bán hải sản khô, yến sào và quà lưu niệm.'],
    ['Biển Trần Phú', 'nature', 12.239, 109.197, 'Bãi biển trung tâm dài hơn 6 cây số, công viên ven biển rợp bóng dừa.'],
    ['Viện Hải dương học Nha Trang', 'museum', 12.208, 109.214, 'Bảo tàng sinh vật biển với hàng nghìn mẫu vật và bể cá san hô.'],
    ['Hòn Chồng', 'nature', 12.273, 109.204, 'Những khối đá chồng lên nhau sát biển, gắn với truyền thuyết dấu bàn tay khổng lồ.'],
    ['Tắm bùn Tháp Bà', 'entertainment', 12.274, 109.186, 'Khu tắm bùn khoáng nóng nổi tiếng, có hồ khoáng và thác nước nóng.'],
    ['Chợ đêm Nha Trang', 'shopping', 12.24, 109.196, 'Chợ đêm gần biển bán quần áo, đồ lưu niệm và hải sản nướng.'],
    ['Phố bún chả cá Phan Bội Châu', 'food', 12.252, 109.193, 'Các quán bún chả cá lâu năm với chả cá chiên, chả hấp và nước dùng ngọt.'],
    ['Phố nem nướng Lãn Ông', 'food', 12.253, 109.191, 'Khu quán nem nướng Ninh Hòa cuốn bánh tráng, rau sống và nước chấm sệt.'],
  ],
  'Đà Lạt': [
    ['Hồ Xuân Hương', 'nature', 11.942, 108.442, 'Hồ nước hình trăng lưỡi liềm giữa thành phố, đường quanh hồ khoảng 5 cây số.'],
    ['Chợ Đà Lạt', 'shopping', 11.943, 108.437, 'Chợ trung tâm bán rau, hoa, mứt và dâu tây đặc sản Đà Lạt.'],
    ['Ga Đà Lạt', 'historical', 11.942, 108.455, 'Nhà ga xây năm 1938 với ba mái nhọn mô phỏng núi Langbiang, có tàu chạy đến Trại Mát.'],
    ['Dinh Bảo Đại', 'historical', 11.93, 108.43, 'Dinh thự mùa hè của vua Bảo Đại giữa rừng thông, giữ nguyên nội thất xưa.'],
    ['Nhà thờ Con Gà Đà Lạt', 'landmark', 11.937, 108.439, 'Nhà thờ chính tòa có tượng gà trống trên tháp chuông, xây những năm 1930.'],
    ['Thiền viện Trúc Lâm Đà Lạt', 'historical', 11.902, 108.435, 'Thiền viện trên núi Phượng Hoàng nhìn xuống hồ Tuyền Lâm, có cáp treo đi lên.'],
    ['Đồi chè Cầu Đất', 'nature', 11.85, 108.56, 'Đồi chè xanh mướt trên cao nguyên, sáng sớm có mây bay ngang tầm mắt.'],
    ['Thung lũng Tình Yêu', 'nature', 11.978, 108.45, 'Thung lũng có hồ Đa Thiện, rừng thông và vườn hoa, hợp cho gia đình.'],
    ['Biệt thự Hằng Nga', 'landmark', 11.935, 108.431, 'Ngôi nhà kiến trúc kỳ lạ như thân cây và hang động, hay được gọi là ngôi nhà điên.'],
    ['Chợ đêm Đà Lạt', 'food', 11.9425, 108.4365, 'Chợ đêm bên dốc chợ với bánh tráng nướng, sữa đậu nành nóng và xiên nướng.'],
    ['Vườn hoa thành phố Đà Lạt', 'nature', 11.95, 108.448, 'Vườn hoa bên hồ Xuân Hương trồng hàng trăm loài hoa, đẹp nhất mùa lễ hội hoa.'],
    ['Bánh căn Nhà Chung', 'food', 11.9395, 108.4345, 'Quán bánh căn nổi tiếng, bánh nướng khuôn đất ăn với xíu mại và nước chấm.'],
    ['Quảng trường Lâm Viên', 'landmark', 11.939, 108.445, 'Quảng trường bên hồ với công trình hình bông hoa dã quỳ và nụ atiso bằng kính.'],
  ],
  'Hạ Long': [
    ['Bãi Cháy', 'nature', 20.955, 107.044, 'Khu du lịch sôi động với bãi tắm nhân tạo, công viên và khách sạn ven vịnh.'],
    ['Cầu Bãi Cháy', 'landmark', 20.9586, 107.0627, 'Cầu dây văng một mặt phẳng dây dài nhất thế giới khi khánh thành năm 2006.'],
    ['Bảo tàng Quảng Ninh', 'museum', 20.9511, 107.0855, 'Bảo tàng hình khối đen kể về vịnh Hạ Long, lịch sử và nghề mỏ than.'],
    ['Chợ Hạ Long 1', 'shopping', 20.9535, 107.0817, 'Chợ lớn của Hòn Gai, nơi mua chả mực, mực khô và hải sản tươi.'],
    ['Núi Bài Thơ', 'nature', 20.953, 107.079, 'Ngọn núi khắc thơ của vua Lê Thánh Tông, đứng trên đỉnh nhìn toàn cảnh vịnh.'],
    ['Sun World Hạ Long', 'entertainment', 20.958, 107.05, 'Khu vui chơi có cáp treo Nữ Hoàng, vòng quay Mặt Trời và công viên nước.'],
    ['Cảng tàu Tuần Châu', 'landmark', 20.93, 106.99, 'Cảng tàu khách nơi các du thuyền khởi hành đi thăm vịnh Hạ Long.'],
    ['Chùa Long Tiên', 'historical', 20.954, 107.08, 'Ngôi chùa lớn nhất Hạ Long dưới chân núi Bài Thơ, xây từ năm 1941.'],
    ['Chợ đêm Bãi Cháy', 'food', 20.956, 107.047, 'Khu chợ đêm ven biển với hàng hải sản nướng và đồ lưu niệm.'],
    ['Hang Sửng Sốt', 'nature', 20.841, 107.088, 'Một trong những hang động rộng và đẹp nhất vịnh, đi đến bằng tàu thăm vịnh.'],
    ['Đảo Ti Tốp', 'nature', 20.859, 107.075, 'Hòn đảo có bãi tắm hình vầng trăng và đường leo lên đỉnh ngắm vịnh.'],
  ],
  'Cần Thơ': [
    ['Chợ nổi Cái Răng', 'food', 10.0045, 105.7469, 'Chợ nổi họp từ sáng sớm trên sông Cần Thơ, ghe treo hàng lên cây bẹo.'],
    ['Bến Ninh Kiều', 'landmark', 10.0335, 105.788, 'Bến sông biểu tượng của Cần Thơ với công viên và tượng Bác Hồ ven sông Hậu.'],
    ['Nhà cổ Bình Thủy', 'historical', 10.0606, 105.7445, 'Nhà cổ của dòng họ Dương, kiến trúc Pháp kết hợp Việt, xây năm 1870.'],
    ['Chùa Ông Cần Thơ', 'historical', 10.033, 105.787, 'Hội quán Quảng Triệu của người Hoa thờ Quan Công, nằm đối diện bến Ninh Kiều.'],
    ['Chợ đêm Tây Đô', 'food', 10.03, 105.783, 'Chợ đêm với các món miền Tây: bánh xèo, hủ tiếu, chè và trái cây.'],
    ['Thiền viện Trúc Lâm Phương Nam', 'historical', 10.005, 105.71, 'Thiền viện lớn nhất miền Tây, kiến trúc gỗ theo phong cách thời Lý Trần.'],
    ['Vườn trái cây Mỹ Khánh', 'nature', 10.008, 105.718, 'Vườn cây ăn trái miệt vườn, có trò chơi dân gian và đua heo.'],
    ['Bảo tàng Cần Thơ', 'museum', 10.031, 105.783, 'Bảo tàng giới thiệu lịch sử vùng đất Tây Đô và văn hóa Kinh, Hoa, Khmer.'],
    ['Cầu đi bộ Cần Thơ', 'entertainment', 10.035, 105.789, 'Cây cầu đi bộ hình cánh buồm nối bến Ninh Kiều với cồn Cái Khế, đổi màu ban đêm.'],
    ['Lò hủ tiếu Cái Răng', 'food', 10.0, 105.75, 'Lò làm hủ tiếu thủ công, du khách xem tráng bánh và phơi bánh.'],
    ['Chợ cổ Cần Thơ', 'shopping', 10.032, 105.788, 'Ngôi chợ cổ hơn trăm năm tuổi bên sông, nay bán đặc sản và đồ lưu niệm.'],
  ],
  'Phú Quốc': [
    ['Chợ đêm Phú Quốc', 'food', 10.217, 103.96, 'Chợ đêm Dương Đông với hải sản nướng, gỏi cá trích và kem cuộn.'],
    ['Dinh Cậu', 'historical', 10.216, 103.957, 'Ngôi miếu trên mỏm đá ở cửa sông Dương Đông, nơi ngư dân cầu bình an.'],
    ['Bãi Sao', 'nature', 10.057, 104.037, 'Bãi biển cát trắng mịn, nước xanh ngọc ở phía nam đảo.'],
    ['Nhà tù Phú Quốc', 'historical', 10.04, 104.02, 'Di tích nhà tù Cây Dừa, nơi giam giữ tù binh trong thời chiến tranh.'],
    ['Cáp treo Hòn Thơm', 'entertainment', 10.028, 104.009, 'Tuyến cáp treo vượt biển dài gần 8 cây số đi ra quần đảo An Thới.'],
    ['Nhà thùng nước mắm Phú Quốc', 'food', 10.22, 103.965, 'Nhà thùng ủ nước mắm cá cơm truyền thống trong thùng gỗ lớn.'],
    ['Vườn tiêu Phú Quốc', 'nature', 10.25, 103.98, 'Vườn tiêu xanh trên đảo, du khách được hái và mua tiêu tươi.'],
    ['Suối Tranh', 'nature', 10.19, 104.01, 'Con suối giữa rừng nguyên sinh, mùa mưa nước chảy thành thác nhỏ.'],
    ['Chùa Hộ Quốc', 'historical', 10.106, 104.045, 'Thiền viện bên bờ biển phía đông đảo, kiến trúc thời Lý Trần.'],
    ['Bãi Dài', 'nature', 10.34, 103.86, 'Bãi biển hoang sơ ở phía bắc đảo, nổi tiếng với hoàng hôn.'],
    ['Thị trấn Hoàng hôn', 'landmark', 10.023, 104.013, 'Khu phố kiến trúc Địa Trung Hải ở An Thới, có cầu Hôn và show nhạc nước.'],
  ],
  'Sa Pa': [
    ['Nhà thờ đá Sa Pa', 'landmark', 22.336, 103.843, 'Nhà thờ đá do người Pháp xây đầu thế kỷ XX ở trung tâm thị xã.'],
    ['Núi Hàm Rồng', 'nature', 22.337, 103.848, 'Ngọn núi có vườn hoa, vườn lan và sân mây nhìn xuống thị xã Sa Pa.'],
    ['Bản Cát Cát', 'historical', 22.329, 103.832, 'Bản làng của người H\'Mông với nhà gỗ, thác nước và nghề dệt lanh.'],
    ['Chợ Sa Pa', 'shopping', 22.334, 103.844, 'Chợ trung tâm bán thổ cẩm, rượu ngô và đặc sản vùng cao.'],
    ['Hồ Sa Pa', 'nature', 22.337, 103.84, 'Hồ nước nhỏ giữa thị xã, buổi sáng có sương mù bao phủ.'],
    ['Bản Tả Van', 'nature', 22.3, 103.88, 'Bản của người Giáy và H\'Mông giữa ruộng bậc thang, có nhiều homestay.'],
    ['Thung lũng Mường Hoa', 'nature', 22.31, 103.87, 'Thung lũng ruộng bậc thang dọc suối Mường Hoa, có bãi đá cổ chạm khắc.'],
    ['Đèo Ô Quy Hồ', 'nature', 22.35, 103.77, 'Một trong tứ đại đỉnh đèo miền Bắc, nhìn thấy dãy Hoàng Liên Sơn.'],
    ['Thác Bạc', 'nature', 22.353, 103.78, 'Thác nước cao khoảng 200 mét đổ xuống từ núi, cạnh đường lên đèo.'],
    ['Phố nướng Sa Pa', 'food', 22.335, 103.8435, 'Dãy hàng nướng buổi tối với trứng nướng, cơm lam và thịt lợn cắp nách.'],
    ['Bảo tàng Sa Pa', 'museum', 22.3365, 103.844, 'Bảo tàng nhỏ giới thiệu lịch sử Sa Pa và văn hóa các dân tộc vùng cao.'],
  ],
  'Vũng Tàu': [
    ['Tượng Chúa Kitô Vua', 'landmark', 10.327, 107.085, 'Tượng Chúa cao 32 mét trên đỉnh Núi Nhỏ, leo khoảng 800 bậc để lên vai tượng.'],
    ['Hải đăng Vũng Tàu', 'landmark', 10.334, 107.077, 'Ngọn hải đăng do Pháp xây năm 1910 trên Núi Nhỏ, nhìn toàn cảnh thành phố.'],
    ['Bãi Sau', 'nature', 10.345, 107.095, 'Bãi biển dài và thoải nhất Vũng Tàu, sóng nhẹ hợp tắm biển.'],
    ['Bãi Trước', 'nature', 10.346, 107.072, 'Bãi biển trong lòng thành phố, có công viên và thuyền đánh cá neo đậu.'],
    ['Bạch Dinh', 'historical', 10.353, 107.068, 'Dinh thự màu trắng do Pháp xây năm 1898 trên sườn Núi Lớn nhìn ra biển.'],
    ['Niết Bàn Tịnh Xá', 'historical', 10.33, 107.075, 'Ngôi chùa có tượng Phật nằm dài 12 mét dưới chân Núi Nhỏ.'],
    ['Mũi Nghinh Phong', 'nature', 10.32, 107.082, 'Mũi đất nhô ra biển ở đầu Núi Nhỏ, có cổng trời nhìn ra biển.'],
    ['Chợ hải sản Xóm Lưới', 'food', 10.342, 107.073, 'Chợ hải sản của ngư dân, mua xong có thể nhờ quán gần đó chế biến.'],
    ['Bánh khọt Gốc Vú Sữa', 'food', 10.349, 107.079, 'Quán bánh khọt nổi tiếng, bánh giòn nhân tôm ăn với rau sống.'],
    ['Hồ Mây Park', 'entertainment', 10.352, 107.07, 'Khu du lịch trên đỉnh Núi Lớn, đi cáp treo lên và có nhiều trò chơi.'],
    ['Bảo tàng Robert Taylor', 'museum', 10.351, 107.069, 'Bảo tàng tư nhân trưng bày vũ khí cổ và hiện vật lịch sử Việt Nam.'],
  ],
  'Ninh Bình': [
    ['Cố đô Hoa Lư', 'historical', 20.2867, 105.9064, 'Kinh đô nhà Đinh và Tiền Lê thế kỷ X, có đền vua Đinh và đền vua Lê.'],
    ['Bến thuyền Tràng An', 'nature', 20.2547, 105.9157, 'Bến thuyền đi qua các hang xuyên thủy của quần thể Tràng An, di sản thế giới kép.'],
    ['Hang Múa', 'nature', 20.2333, 105.9311, 'Gần 500 bậc đá lên đỉnh có tượng rồng, nhìn xuống đồng lúa Tam Cốc.'],
    ['Tam Cốc', 'nature', 20.2161, 105.9369, 'Ba hang động trên sông Ngô Đồng, đẹp nhất mùa lúa chín.'],
    ['Chùa Bái Đính', 'historical', 20.274, 105.864, 'Quần thể chùa lớn với hành lang La Hán và chuông đồng nặng hàng chục tấn.'],
    ['Nhà thờ Phát Diệm', 'landmark', 20.092, 106.08, 'Quần thể nhà thờ đá cuối thế kỷ XIX mang dáng dấp chùa Việt.'],
    ['Đầm Vân Long', 'nature', 20.37, 105.865, 'Khu bảo tồn đất ngập nước, nơi sống của voọc mông trắng, đi thuyền nan.'],
    ['Chùa Bích Động', 'historical', 20.224, 105.93, 'Ngôi chùa ba tầng tựa vào núi đá, gần bến thuyền Tam Cốc.'],
    ['Vườn chim Thung Nham', 'nature', 20.216, 105.89, 'Vườn chim giữa thung lũng núi đá, chiều tối hàng nghìn con chim về tổ.'],
    ['Phố cổ Hoa Lư', 'entertainment', 20.253, 105.975, 'Phố đi bộ ven sông Vân ở thành phố Ninh Bình, tối thả đèn hoa đăng.'],
    ['Phố dê núi Tam Cốc', 'food', 20.218, 105.936, 'Các quán dê núi tái chanh, dê nướng và cơm cháy đặc sản Ninh Bình.'],
  ],
};

// Theme = place types it draws from (null = all), one title per variant, an intro sentence and
// the travel mode per variant. A variant with fewer than 3 matching places is skipped.
const THEMES = [
  { types: ['historical', 'landmark'], modes: ['walking', 'cycling'],
    titles: [(c) => `${c}: dấu ấn lịch sử`, (c) => `Di tích ${c} bằng xe đạp`],
    intro: (c) => `Hành trình qua những di tích và công trình gắn với lịch sử ${c}` },
  { types: ['food'], modes: ['walking', 'walking'],
    titles: [(c) => `${c} ẩm thực đường phố`, (c) => `Ăn gì ở ${c}?`],
    intro: (c) => `Đi ăn những món ngon nổi tiếng của ${c}` },
  { types: ['nature'], modes: ['cycling', 'driving'],
    titles: [(c) => `Thiên nhiên ${c}`, (c) => `${c} xanh: cảnh đẹp quanh thành phố`],
    intro: (c) => `Ra khỏi phố để ngắm thiên nhiên ${c}` },
  { types: ['museum', 'historical'], modes: ['walking', 'indoor'],
    titles: [(c) => `Bảo tàng và văn hóa ${c}`, (c) => `Văn hóa ${c} trong một buổi`],
    intro: (c) => `Tìm hiểu văn hóa và con người ${c}` },
  { types: ['entertainment', 'food', 'shopping'], modes: ['walking', 'driving'],
    titles: [(c) => `${c} về đêm`, (c) => `Chợ và phố đêm ${c}`],
    intro: (c) => `Buổi tối ở ${c}: chợ, phố đi bộ và hàng quán` },
  { types: ['shopping', 'food'], modes: ['walking', 'cycling'],
    titles: [(c) => `Mua sắm ở ${c}`, (c) => `Chợ truyền thống ${c}`],
    intro: (c) => `Dạo chợ và mua đặc sản ${c} làm quà` },
  { types: null, modes: ['driving', 'walking', 'cycling'],
    titles: [(c) => `Một ngày khám phá ${c}`, (c) => `${c} cho người lần đầu đến`, (c) => `${c} cùng gia đình`],
    intro: (c) => `Những điểm không nên bỏ lỡ khi đến ${c}` },
];

const MODE_TEXT = {
  walking: 'Đi bộ', cycling: 'Đạp xe', driving: 'Đi xe máy hoặc ô tô', indoor: 'Tham quan trong nhà',
};
const MINUTES_PER_PLACE = { walking: 25, cycling: 30, driving: 45, indoor: 20 };

function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[2] - a[2]) / 2) ** 2
    + Math.cos(rad(a[2])) * Math.cos(rad(b[2])) * Math.sin(rad(b[3] - a[3]) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Nearest neighbour from the first place, so the route does not zigzag across the city.
function orderRoute(places) {
  const left = places.slice(1);
  const route = [places[0]];
  while (left.length) {
    const last = route[route.length - 1];
    left.sort((a, b) => distanceKm(last, a) - distanceKm(last, b));
    route.push(left.shift());
  }
  return route;
}

/** Tours built from CATALOG, numbered from `firstN`, same shape as the TOURS of seed-tours.js. */
export function catalogTours(firstN) {
  const tours = [];
  let n = firstN;
  for (const [city, pois] of Object.entries(CATALOG)) {
    const seen = new Set();
    for (const theme of THEMES) {
      const pool = theme.types ? pois.filter((p) => theme.types.includes(p[1])) : pois;
      if (pool.length < 3) continue;
      theme.titles.forEach((title, v) => {
        const count = Math.min(pool.length, 3 + ((v + pool.length) % 3)); // 3..5 places
        const picked = [...pool.slice(v * 2 % pool.length), ...pool].slice(0, count);
        const key = picked.map((p) => p[0]).sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        const places = orderRoute(picked);
        const longest = Math.max(...places.slice(1).map((p, i) => distanceKm(places[i], p)));
        let type = theme.modes[v];
        if (type === 'walking' && longest > 3) type = 'driving'; // too far apart to walk
        if (type === 'indoor' && places.some((p) => p[1] !== 'museum')) type = 'walking';
        tours.push({
          n: n++, city, type, title: title(city),
          duration: Math.ceil((places.length * MINUTES_PER_PLACE[type]) / 15) * 15,
          description: `${theme.intro(city)}. ${MODE_TEXT[type]} qua ${places.length} điểm: `
            + `${places.map((p) => p[0]).join(', ')}.`,
          places,
        });
      });
    }
  }
  return tours;
}
