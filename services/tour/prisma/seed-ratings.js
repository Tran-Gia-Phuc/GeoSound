// =========================================================
// #341 — dev seed: real tour_ratings rows (UC05) for every public tour, then tours.rating_count /
// average_rating recomputed from the rows. NOT for production.
// Why: an older seed wrote only the aggregate (e.g. 87 ratings) and no rows, so the star bars
// (counted from tour_ratings) showed 0 everywhere and a new rating moved 87 -> 88.
// Deterministic (seeded by tour id) + upsert on (tour_id, user_id): running it again rewrites the
// same rows. Reviewers are fixed fake ids 5eedfa11-...; ratings of real accounts are kept and counted.
// Raw SQL for the aggregate so tours.updated_at (moderation / catalog revision) does not move.
// Run: node prisma/seed-ratings.js  (or: npm run seed:ratings)
// =========================================================
import { PrismaClient, Prisma } from '@prisma/client';
import { schemaFromUrl } from '../src/infrastructure/persistence/schema-name.js';

const prisma = new PrismaClient();
const schema = schemaFromUrl(process.env.DATABASE_URL);
const tours = Prisma.raw(`"${schema}"."tours"`);
const ratings = Prisma.raw(`"${schema}"."tour_ratings"`);

const NAMES = [
  'Minh Anh', 'Quốc Bảo', 'Thu Hà', 'Gia Huy', 'Ngọc Lan', 'Đức Minh', 'Phương Linh', 'Hoàng Nam',
  'Khánh Vy', 'Tuấn Kiệt', 'Mai Chi', 'Thanh Tùng', 'Bảo Ngọc', 'Hải Đăng', 'Diệu Linh', 'Văn Long',
  'Thùy Dương', 'Anh Khoa', 'Hồng Nhung', 'Trung Hiếu', 'Lan Hương', 'Nhật Minh', 'Kim Ngân', 'Quang Vinh',
  'Tú Anh', 'Đình Phúc', 'Yến Nhi', 'Công Danh', 'Ngọc Hân', 'Sơn Tùng',
];
const COMMENTS = {
  5: ['Tour rất hay, thuyết minh dễ nghe và đúng điểm.', 'Đi một mình vẫn thấy như có hướng dẫn viên, rất đáng thử.', 'Lộ trình hợp lý, kể chuyện cuốn hút.'],
  4: ['Nội dung tốt, vài điểm hơi gần nhau nên audio chồng lên.', 'Hay, mong có thêm vài điểm ăn uống.', 'Thông tin bổ ích, giọng đọc ổn.'],
  3: ['Tạm ổn, phần mô tả hơi ngắn.', 'Được, nhưng nên đi buổi sáng cho đỡ đông.'],
  2: ['Vài điểm kích hoạt audio không chuẩn vị trí.'],
  1: ['Lộ trình chưa hợp lý, đi khá mệt.'],
};
const STAR_WEIGHTS = [[5, 0.5], [4, 0.3], [3, 0.12], [2, 0.05], [1, 0.03]];
const BASE_DAY = Date.UTC(2026, 10, 1); // fixed, so a rerun writes the same dates

const reviewerId = (i) => `5eedfa11-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`;

// Small seeded PRNG (mulberry32) keyed by the tour id: same tour -> same ratings.
function rng(key) {
  let a = [...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickStars(r) {
  let x = r();
  for (const [stars, w] of STAR_WEIGHTS) if ((x -= w) < 0) return stars;
  return 5;
}

function ratingsFor(tourId) {
  const r = rng(tourId);
  const order = NAMES.map((_, i) => i).sort(() => r() - 0.5);
  const count = 8 + Math.floor(r() * 23); // 8..30 reviewers
  return order.slice(0, count).map((i) => {
    const stars = pickStars(r);
    const pool = COMMENTS[stars];
    return {
      tourId, userId: reviewerId(i), userName: NAMES[i], stars,
      comment: r() < 0.6 ? pool[Math.floor(r() * pool.length)] : null,
      createdAt: new Date(BASE_DAY - Math.floor(r() * 90 * 86400000)),
    };
  });
}

async function main() {
  const publicTours = await prisma.tour.findMany({ where: { status: 'public' }, select: { id: true, title: true } });
  for (const t of publicTours) {
    const rows = ratingsFor(t.id);
    for (const row of rows) {
      const { tourId, userId, ...data } = row;
      await prisma.tourRating.upsert({ where: { tourId_userId: { tourId, userId } }, create: row, update: data });
    }
    console.log(`[seed] ${rows.length} ratings: ${t.title}`);
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE ${tours} t
       SET rating_count   = (SELECT count(*) FROM ${ratings} r WHERE r.tour_id = t.id),
           average_rating = COALESCE((SELECT avg(r.stars) FROM ${ratings} r WHERE r.tour_id = t.id), 0)`);

  // Self-check: the aggregate must equal the rows the star bars count.
  for (const t of publicTours) {
    const [tour, rows] = await Promise.all([
      prisma.tour.findUnique({ where: { id: t.id }, select: { ratingCount: true } }),
      prisma.tourRating.count({ where: { tourId: t.id } }),
    ]);
    if (tour.ratingCount !== rows) throw new Error(`rating_count ${tour.ratingCount} != ${rows} rows (${t.id})`);
  }
  console.log(`[seed] ${publicTours.length} tours: rating_count / average_rating match tour_ratings`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
