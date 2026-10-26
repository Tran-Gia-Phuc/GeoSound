// =========================================================
// Unit test UC09 — chạy use-case với fake TourRepository trong RAM (không cần DB).
// Chứng minh lõi nghiệp vụ tách khỏi hạ tầng (Clean Architecture).
//   node --test  (hoặc: npm test)
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CreateTour } from '../src/application/use-cases/create-tour.js';
import { ListMyTours } from '../src/application/use-cases/list-my-tours.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { DeleteTour } from '../src/application/use-cases/delete-tour.js';
import { TOUR_STATUS } from '../src/domain/entities/tour.js';

// Fake repo: gán id tăng dần, lưu entity trực tiếp (giữ nguyên tham chiếu entity).
function makeRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  let seq = seed.length;
  return {
    rows,
    async create(tour) {
      tour.id = `t${++seq}`;
      tour.createdAt = new Date();
      tour.updatedAt = new Date();
      rows.set(tour.id, tour);
      return tour;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByAuthor(authorId) {
      return [...rows.values()].filter((t) => t.authorId === authorId);
    },
    async save(tour) {
      rows.set(tour.id, tour);
      return tour;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

test('CreateTour: tạo tour mặc định trạng thái Nháp', async () => {
  const repo = makeRepo();
  const uc = new CreateTour({ tourRepo: repo });
  const tour = await uc.execute({
    authorId: 'u1',
    title: '  Phố cổ Hội An  ',
    originalLanguage: 'VI',
  });
  assert.equal(tour.status, TOUR_STATUS.DRAFT);
  assert.equal(tour.title, 'Phố cổ Hội An'); // đã trim
  assert.equal(tour.originalLanguage, 'vi'); // đã chuẩn hóa
  assert.equal(tour.authorId, 'u1');
});

test('CreateTour: thiếu/không hỗ trợ ngôn ngữ gốc → lỗi (E2)', async () => {
  const uc = new CreateTour({ tourRepo: makeRepo() });
  await assert.rejects(() => uc.execute({ authorId: 'u1', title: 'X', originalLanguage: '' }), /ngôn ngữ gốc/i);
  await assert.rejects(
    () => uc.execute({ authorId: 'u1', title: 'X', originalLanguage: 'de' }),
    /không hỗ trợ/i
  );
});

test('ListMyTours: chỉ trả tour của chính tác giả', async () => {
  const repo = makeRepo();
  const create = new CreateTour({ tourRepo: repo });
  await create.execute({ authorId: 'u1', title: 'A', originalLanguage: 'vi' });
  await create.execute({ authorId: 'u2', title: 'B', originalLanguage: 'vi' });
  const mine = await new ListMyTours({ tourRepo: repo }).execute({ authorId: 'u1' });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, 'A');
});

test('UpdateTour: sửa tour công khai → về Nháp, cần gửi duyệt lại', async () => {
  const repo = makeRepo();
  const tour = await new CreateTour({ tourRepo: repo }).execute({
    authorId: 'u1',
    title: 'Cũ',
    originalLanguage: 'vi',
  });
  repo.rows.get(tour.id).status = TOUR_STATUS.PUBLIC; // giả lập tour đã công khai

  const result = await new UpdateTour({ tourRepo: repo }).execute({
    authorId: 'u1',
    tourId: tour.id,
    patch: { title: 'Mới' },
  });
  assert.equal(result.requiresResubmit, true);
  assert.equal(result.tour.status, TOUR_STATUS.DRAFT);
  assert.equal(result.tour.title, 'Mới');
});

test('UpdateTour: người khác sửa tour không phải của mình → 403', async () => {
  const repo = makeRepo();
  const tour = await new CreateTour({ tourRepo: repo }).execute({
    authorId: 'u1',
    title: 'A',
    originalLanguage: 'vi',
  });
  await assert.rejects(
    () => new UpdateTour({ tourRepo: repo }).execute({ authorId: 'uX', tourId: tour.id, patch: { title: 'hack' } }),
    (err) => err.status === 403
  );
});

test('DeleteTour: tour không tồn tại → 404', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () => new DeleteTour({ tourRepo: repo }).execute({ authorId: 'u1', tourId: 'nope' }),
    (err) => err.status === 404
  );
});

test('ListMyTours: kèm số điểm dừng của mỗi tour', async () => {
  const repo = makeRepo();
  const create = new CreateTour({ tourRepo: repo });
  const t = await create.execute({ authorId: 'u1', title: 'A', originalLanguage: 'vi' });
  const placeRepo = { async statsByTours(ids) { return new Map(ids.map((id) => [id, { count: id === t.id ? 3 : 0 }])); } };
  const [mine] = await new ListMyTours({ tourRepo: repo, placeRepo }).execute({ authorId: 'u1' });
  assert.equal(mine.placeCount, 3);
});
