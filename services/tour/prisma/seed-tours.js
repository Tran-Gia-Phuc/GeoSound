// =========================================================
// #341, #349 — dev seed: more public demo tours (places, route, source language). NOT for production.
// Fixed ids + upsert, so running it again updates the same rows instead of adding copies.
// Author = SEED_AUTHOR_ID, else the author of the oldest public tour (an existing contributor).
// Run: node prisma/seed-tours.js  (or: npm run seed:tours), then refresh the chatbot index:
// docs/04-guides/seed-data.md. Rows are written directly, so no tour.published is sent here.
// =========================================================
import { PrismaClient } from '@prisma/client';
import { PLACE_TYPES } from '../src/domain/entities/place.js';
import { TOUR_TYPES } from '../src/domain/entities/tour.js';
import { catalogTours } from './seed-catalog.js';

const prisma = new PrismaClient();

const picsum = (seed, size) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${size}`;

// Place = [name, type, lat, lng, description]. Ids: tour 5eedTTTT-..., place 5eedTTTT-...-0000000000PP
// (TTTT = n on 4 digits, so the first 7 keep their old 5eed00NN ids). n >= 101: seed-catalog.js (#349).
const TOURS = [
  {
    n: 1, title: 'Văn Miếu và Hoàng thành Thăng Long', city: 'Hà Nội', type: 'walking', duration: 120,
    description: 'Hành trình qua nghìn năm văn hiến: trường đại học đầu tiên của Việt Nam, khu di sản Hoàng thành và những biểu tượng giữa lòng Ba Đình.',
    places: [
      ['Văn Miếu - Quốc Tử Giám', 'historical', 21.0294, 105.8355, 'Văn Miếu được xây năm 1070 thờ Khổng Tử, sáu năm sau Quốc Tử Giám ra đời, được xem là trường đại học đầu tiên của Việt Nam. 82 tấm bia tiến sĩ đặt trên lưng rùa đá ghi tên những người đỗ đạt qua các khoa thi.'],
      ['Hoàng thành Thăng Long', 'historical', 21.0352, 105.8403, 'Khu trung tâm Hoàng thành là di sản thế giới UNESCO từ năm 2010. Điện Kính Thiên, Đoan Môn và các tầng khảo cổ ở 18 Hoàng Diệu kể lại lịch sử kinh đô qua nhiều triều đại.'],
      ['Cột cờ Hà Nội', 'landmark', 21.0325, 105.8399, 'Cột cờ cao hơn 33 mét được xây năm 1812 dưới thời Gia Long, là một trong số ít công trình còn gần như nguyên vẹn của thành Hà Nội xưa.'],
      ['Lăng Chủ tịch Hồ Chí Minh', 'landmark', 21.0368, 105.8346, 'Lăng nằm trên quảng trường Ba Đình, nơi Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập ngày 2 tháng 9 năm 1945. Lễ thượng cờ và hạ cờ mỗi ngày thu hút nhiều du khách.'],
    ],
  },
  {
    n: 2, title: 'Sài Gòn ẩm thực đêm', city: 'Hồ Chí Minh', type: 'walking', duration: 120,
    description: 'Đi bộ ăn tối kiểu Sài Gòn: chợ truyền thống, hẻm ăn vặt và phố đi bộ sôi động đến khuya.',
    places: [
      ['Chợ Bến Thành', 'food', 10.7725, 106.698, 'Chợ Bến Thành hơn trăm năm tuổi là biểu tượng của Sài Gòn. Buổi tối khu quanh chợ có nhiều hàng cơm tấm, bún mắm, chè và hải sản.'],
      ['Chợ Bàn Cờ', 'food', 10.7714, 106.6805, 'Chợ nhỏ trong khu dân cư quận 3, nổi tiếng với các món ăn vặt giá bình dân như bánh tráng trộn, ốc và phá lấu.'],
      ['Phố ẩm thực Hồ Thị Kỷ', 'food', 10.7651, 106.6795, 'Con hẻm nổi tiếng với giới trẻ: bánh tráng nướng, xiên que, trà sữa và các quầy hoa tươi bên cạnh.'],
      ['Phố đi bộ Bùi Viện', 'entertainment', 10.7674, 106.6936, 'Phố Tây Bùi Viện sôi động về đêm với quán bar, nhạc sống và các xe đồ ăn đường phố.'],
    ],
  },
  {
    n: 3, title: 'Tràng An - Hoa Lư đạp xe', city: 'Ninh Bình', type: 'cycling', duration: 180,
    description: 'Đạp xe giữa núi đá vôi và cánh đồng lúa, ghé cố đô Hoa Lư và những bến thuyền đẹp nhất Ninh Bình.',
    places: [
      ['Cố đô Hoa Lư', 'historical', 20.2867, 105.9064, 'Hoa Lư là kinh đô của nhà Đinh và Tiền Lê ở thế kỷ X. Đền vua Đinh Tiên Hoàng và đền vua Lê Đại Hành vẫn còn giữ nhiều nét kiến trúc cổ.'],
      ['Bến thuyền Tràng An', 'nature', 20.2547, 105.9157, 'Quần thể danh thắng Tràng An là di sản thế giới kép. Thuyền đi qua các hang xuyên thủy giữa núi đá vôi, mất khoảng hai đến ba giờ.'],
      ['Hang Múa', 'nature', 20.2333, 105.9311, 'Leo gần 500 bậc đá lên đỉnh Hang Múa để ngắm toàn cảnh Tam Cốc với dòng sông Ngô Đồng uốn lượn giữa đồng lúa.'],
      ['Tam Cốc', 'nature', 20.2161, 105.9369, 'Tam Cốc gồm ba hang động trên sông Ngô Đồng, đẹp nhất vào mùa lúa chín tháng 5 và tháng 6.'],
    ],
  },
  {
    n: 4, title: 'Cần Thơ chợ nổi bình minh', city: 'Cần Thơ', type: 'driving', duration: 150,
    description: 'Dậy sớm đón bình minh trên sông Hậu, ăn sáng trên chợ nổi và ghé những công trình cổ của Tây Đô.',
    places: [
      ['Chợ nổi Cái Răng', 'food', 10.0045, 105.7469, 'Chợ nổi họp từ khoảng 5 giờ sáng. Mỗi ghe treo hàng mình bán lên cây bẹo; du khách có thể ăn hủ tiếu, uống cà phê ngay trên thuyền.'],
      ['Bến Ninh Kiều', 'landmark', 10.0335, 105.788, 'Bến Ninh Kiều bên sông Hậu là biểu tượng của Cần Thơ, có cầu đi bộ và chợ đêm ven sông.'],
      ['Nhà cổ Bình Thủy', 'historical', 10.0606, 105.7445, 'Ngôi nhà cổ hơn trăm năm tuổi kết hợp kiến trúc Pháp và Việt, từng là bối cảnh của nhiều bộ phim.'],
    ],
  },
  {
    n: 5, title: 'Hạ Long bên vịnh di sản', city: 'Hạ Long', type: 'driving', duration: 240,
    description: 'Một ngày quanh bờ vịnh Hạ Long: bãi biển, cây cầu dây văng nổi tiếng, bảo tàng và chợ hải sản.',
    places: [
      ['Bãi Cháy', 'nature', 20.955, 107.044, 'Bãi Cháy là khu du lịch sôi động nhất Hạ Long với bãi tắm, công viên và cáp treo lên đồi ngắm vịnh.'],
      ['Cầu Bãi Cháy', 'landmark', 20.9586, 107.0627, 'Cầu dây văng một mặt phẳng dây nối Bãi Cháy với Hòn Gai, đẹp nhất khi lên đèn buổi tối.'],
      ['Bảo tàng Quảng Ninh', 'museum', 20.9511, 107.0855, 'Tòa nhà màu đen bóng như khối than đá kể về thiên nhiên vịnh Hạ Long, lịch sử và nghề mỏ của Quảng Ninh.'],
      ['Chợ Hạ Long 1', 'shopping', 20.9535, 107.0817, 'Chợ lớn nhất Hòn Gai, nơi mua mực khô, chả mực và hải sản tươi làm quà.'],
    ],
  },
  {
    n: 6, title: 'Bảo tàng Dân tộc học', city: 'Hà Nội', type: 'indoor', duration: 90,
    description: 'Tham quan bên trong bảo tàng: văn hóa 54 dân tộc Việt Nam qua hiện vật và vườn kiến trúc nhà truyền thống.',
    places: [
      ['Tòa Trống đồng', 'museum', 21.0405, 105.7984, 'Khu trưng bày chính giới thiệu trang phục, nhạc cụ, đồ dùng và tín ngưỡng của các dân tộc theo từng nhóm ngôn ngữ.'],
      ['Vườn kiến trúc', 'museum', 21.0412, 105.7979, 'Khu ngoài trời dựng lại nhà thật của nhiều dân tộc, do chính người dân các vùng đến xây theo cách truyền thống.'],
      ['Nhà Rông Ba Na', 'historical', 21.0415, 105.7975, 'Nhà rông mái cao gần 20 mét là nơi sinh hoạt cộng đồng của người Ba Na ở Tây Nguyên.'],
    ],
  },
  {
    n: 7, title: 'Hội An ẩm thực phố cổ', city: 'Hội An', type: 'walking', duration: 90,
    description: 'Đi bộ thưởng thức món ngon Hội An: cao lầu, mì Quảng, bánh mì và chè trong lòng phố cổ.',
    places: [
      ['Chợ Hội An', 'food', 15.877, 108.33, 'Khu ăn uống trong chợ Hội An có đủ cao lầu, mì Quảng, cơm gà và bánh xèo với giá bình dân.'],
      ['Phố Trần Phú', 'food', 15.8771, 108.327, 'Con phố cổ nhiều hội quán, dọc đường có các quán cao lầu và bánh mì lâu năm.'],
      ['Bờ sông Hoài', 'food', 15.8762, 108.3285, 'Ven sông Hoài có nhiều hàng chè, bánh đập và nước mót; tối đến ngồi ngắm thuyền đèn lồng.'],
      ['Làng rau Trà Quế', 'nature', 15.9014, 108.3413, 'Làng rau hơn 300 năm cung cấp rau thơm cho các món Hội An; du khách có thể thử làm vườn cùng nông dân.'],
    ],
  },
];

const pad = (num, len) => String(num).padStart(len, '0');
const tourId = (t) => `5eed${pad(t.n, 4)}-0000-4000-8000-000000000000`;
const placeId = (t, i) => `5eed${pad(t.n, 4)}-0000-4000-8000-0000000000${pad(i + 1, 2)}`;
const ALL_TOURS = [...TOURS, ...catalogTours(101)];

// Self-check before any write: unique ids and titles per city, valid types, 3 to 99 places.
function checkTours(tours) {
  const ids = new Set(tours.map(tourId));
  const titles = new Set(tours.map((t) => `${t.city}|${t.title}`));
  if (ids.size !== tours.length || titles.size !== tours.length) throw new Error('duplicate seed tour id or title');
  for (const t of tours) {
    const bad = !TOUR_TYPES.includes(t.type) || t.places.length < 3 || t.places.length > 99
      || t.places.some(([, type, lat, lng]) => !PLACE_TYPES.includes(type) || Math.abs(lat) > 90 || Math.abs(lng) > 180);
    if (bad) throw new Error(`invalid seed tour ${t.n} ${t.title}`);
  }
}

async function seedAuthorId() {
  if (process.env.SEED_AUTHOR_ID) return process.env.SEED_AUTHOR_ID;
  const tour = await prisma.tour.findFirst({ where: { status: 'public' }, orderBy: { createdAt: 'asc' } });
  if (!tour) throw new Error('no public tour to borrow an author from: set SEED_AUTHOR_ID');
  return tour.authorId;
}

async function seedTour(t, authorId) {
  const id = tourId(t);
  const tour = {
    title: t.title, description: t.description, coverImageUrl: picsum(t.title, '1200/600'),
    originalLanguage: 'vi', type: t.type, status: 'public', authorId, city: t.city, duration: t.duration,
  };
  await prisma.tour.upsert({ where: { id }, create: { id, ...tour }, update: tour });

  const places = t.places.map(([name, type, lat, lng, description], i) => ({
    id: placeId(t, i), tourId: id, name, type, lat, lng, description, sequence: i,
    images: [{ url: picsum(name, '800/500'), caption: name }], audioSource: 'tts',
  }));
  for (const p of places) await prisma.place.upsert({ where: { id: p.id }, create: p, update: p });

  const route = {
    path: places.map(({ lat, lng }) => ({ lat, lng })),
    triggers: places.map((p, i) => ({
      placeId: p.id, priority: i,
      zone: { shape: 'circle', center: { lat: p.lat, lng: p.lng }, radiusMeters: 60 },
      ...(places[i + 1] ? { nextHint: `Đi tiếp tới ${places[i + 1].name}` } : {}),
    })),
  };
  await prisma.routeConfig.upsert({ where: { tourId: id }, create: { tourId: id, ...route }, update: route });
  await prisma.tourLanguage.upsert({
    where: { tourId_languageCode: { tourId: id, languageCode: 'vi' } },
    create: { tourId: id, languageCode: 'vi', isSource: true },
    update: { isSource: true },
  });
  console.log(`[seed] tour ${id} ${t.title} (${places.length} places)`);
}

async function main() {
  checkTours(ALL_TOURS);
  const authorId = await seedAuthorId();
  for (const t of ALL_TOURS) await seedTour(t, authorId);
  const places = ALL_TOURS.reduce((sum, t) => sum + t.places.length, 0);
  console.log(`[seed] ${ALL_TOURS.length} tours, ${places} places; now refresh the chatbot index (docs/04-guides/seed-data.md)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
