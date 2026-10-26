// =========================================================
// Unit test UC09 / A3 — xuất bản & gỡ tour (xuất bản thẳng, D1).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GetPublishReadiness, PublishTour, UnpublishTour } from '../src/application/use-cases/publish-tour.js';
import { checkPublishReadiness } from '../src/domain/tour/publish-readiness.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';

function fakeTourRepo(tours) {
  const rows = new Map(tours.map((t) => [t.id, t]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async save(t) { rows.set(t.id, t); return t; },
  };
}
function fakePlaceRepo(byTour) {
  return { async listByTour(tourId) { return byTour[tourId] ?? []; } };
}

const tour = (id, props = {}) =>
  new Tour({ id, title: 'Phố cổ', originalLanguage: 'vi', authorId: 'u1', status: TOUR_STATUS.DRAFT, ...props });
const place = (id, description = 'Mô tả') => ({ id, name: `Điểm ${id}`, description });

function deps() {
  return {
    tourRepo: fakeTourRepo([
      tour('ready'),
      tour('empty'),
      tour('nodesc'),
      tour('live', { status: TOUR_STATUS.PUBLIC }),
      tour('hidden', { status: TOUR_STATUS.HIDDEN }),
      tour('rejected', { status: TOUR_STATUS.REJECTED }),
    ]),
    placeRepo: fakePlaceRepo({
      ready: [place('a'), place('b')],
      nodesc: [place('a'), place('b', '  ')],
      hidden: [place('a')],
      rejected: [place('a')],
      live: [place('a')],
    }),
  };
}

test('checkPublishReadiness: ảnh bìa / mô tả tour chỉ là khuyến nghị', () => {
  const r = checkPublishReadiness({ tour: tour('x'), places: [place('a')] });
  assert.equal(r.ready, true);
  assert.equal(r.checks.find((c) => c.key === 'cover').ok, false);
  assert.equal(r.checks.find((c) => c.key === 'cover').required, false);
});

test('PublishTour: tour nháp đủ điều kiện → công khai', async () => {
  const d = deps();
  const res = await new PublishTour(d).execute({ authorId: 'u1', tourId: 'ready' });
  assert.equal(res.changed, true);
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(d.tourRepo.rows.get('ready').status, TOUR_STATUS.PUBLIC);
});

test('PublishTour: chưa có điểm → 422 tour_not_ready, chỉ ra mục thiếu', async () => {
  await assert.rejects(
    () => new PublishTour(deps()).execute({ authorId: 'u1', tourId: 'empty' }),
    (e) => e.status === 422 && e.code === 'tour_not_ready' && e.missing.some((m) => m.key === 'places'),
  );
});

test('PublishTour: có điểm thiếu mô tả → 422, nhãn nêu tên điểm', async () => {
  await assert.rejects(
    () => new PublishTour(deps()).execute({ authorId: 'u1', tourId: 'nodesc' }),
    (e) => e.status === 422 && e.missing.some((m) => m.key === 'placeDescriptions' && m.label.includes('Điểm b')),
  );
});

test('PublishTour: tour bị quản trị viên ẩn → 409, không tự xuất bản được', async () => {
  await assert.rejects(
    () => new PublishTour(deps()).execute({ authorId: 'u1', tourId: 'hidden' }),
    (e) => e.status === 409,
  );
});

test('PublishTour: tour bị từ chối được xuất bản lại; đã công khai thì không đổi', async () => {
  const d = deps();
  assert.equal((await new PublishTour(d).execute({ authorId: 'u1', tourId: 'rejected' })).tour.status, 'public');
  assert.equal((await new PublishTour(d).execute({ authorId: 'u1', tourId: 'live' })).changed, false);
});

test('PublishTour: không phải tác giả → 403; không tồn tại → 404', async () => {
  await assert.rejects(() => new PublishTour(deps()).execute({ authorId: 'uX', tourId: 'ready' }), (e) => e.status === 403);
  await assert.rejects(() => new PublishTour(deps()).execute({ authorId: 'u1', tourId: 'ghost' }), (e) => e.status === 404);
});

test('UnpublishTour: công khai → Nháp; tour chưa công khai → 409', async () => {
  const d = deps();
  const res = await new UnpublishTour(d).execute({ authorId: 'u1', tourId: 'live' });
  assert.equal(res.tour.status, TOUR_STATUS.DRAFT);
  await assert.rejects(() => new UnpublishTour(d).execute({ authorId: 'u1', tourId: 'ready' }), (e) => e.status === 409);
});

test('GetPublishReadiness: trả checklist + trạng thái + có được tự xuất bản không', async () => {
  const r = await new GetPublishReadiness(deps()).execute({ authorId: 'u1', tourId: 'empty' });
  assert.equal(r.ready, false);
  assert.equal(r.status, 'draft');
  assert.equal(r.canPublish, true);
  assert.ok(r.checks.find((c) => c.key === 'places' && !c.ok));
});

test('GetPublishReadiness: kèm số điểm dừng (cho stepper Studio)', async () => {
  const r = await new GetPublishReadiness(deps()).execute({ authorId: 'u1', tourId: 'ready' });
  assert.equal(r.placeCount, 2);
});
