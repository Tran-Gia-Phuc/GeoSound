// =========================================================
// UC15 / #AI-39 — Tour <-> Moderation events behind MODERATION_EVENTS_ENABLED.
// Fakes only: no broker, no DB, no network. Published payloads are validated with the shared
// zod contract (loaded by test/helpers/shared-events.js).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { Place } from '../src/domain/entities/place.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { UpdatePlace } from '../src/application/use-cases/update-place.js';
import { ReorderPlaces } from '../src/application/use-cases/reorder-places.js';
import { DeletePlace } from '../src/application/use-cases/delete-place.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { GetPublishReadiness, PublishTour } from '../src/application/use-cases/publish-tour.js';
import { ApplyModerationResult } from '../src/application/use-cases/apply-moderation-result.js';
import { EventModerationGateway } from '../src/infrastructure/messaging/event-moderation-gateway.js';
import {
  buildModerationResultHandler,
  MODERATION_RESULT_QUEUE,
  MODERATION_RESULT_BINDINGS,
} from '../src/interfaces/events/moderation-result-handler.js';
import { isModerationEnabled } from '../src/config.js';

// --- fakes (updatedAt moves forward on every write, like Prisma @updatedAt) ---
let tick = Date.parse('2026-01-01T00:00:00.000Z');
const nextDate = () => new Date((tick += 1000));

function fakeTourRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async save(t) { t.updatedAt = nextDate(); rows.set(t.id, t); return t; },
    async updateModeration(id, fields) {
      const t = rows.get(id);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) t[k] = v;
      t.updatedAt = nextDate();
      return t;
    },
    // Like Prisma updateMany WHERE { id, status: 'ai_checking', moderationRevision }.
    async applyModerationResultIf(id, revision, fields) {
      const t = rows.get(id);
      if (!t || t.status !== TOUR_STATUS.AI_CHECKING || t.moderationRevision !== revision) return 0;
      Object.assign(t, fields, { updatedAt: nextDate() });
      return 1;
    },
  };
}

function fakePlaceRepo(seed = []) {
  const rows = new Map(seed.map((p) => [p.id, p]));
  let seq = 0;
  return {
    rows,
    async create(p) { p.id = `p${++seq}`; p.updatedAt = nextDate(); rows.set(p.id, p); return p; },
    async findById(id) { return rows.get(id) ?? null; },
    async listByTour(tourId) {
      return [...rows.values()].filter((p) => p.tourId === tourId).sort((a, b) => a.sequence - b.sequence);
    },
    async save(p) { p.updatedAt = nextDate(); rows.set(p.id, p); return p; },
    async nextSequence(tourId) { return (await this.listByTour(tourId)).length; },
    async reorder(_tourId, ids) { ids.forEach((id, i) => { const p = rows.get(id); p.sequence = i; p.updatedAt = nextDate(); }); },
    async delete(id) { rows.delete(id); },
    // Like Prisma updateMany WHERE { id, moderationRevision }.
    async applyModerationResultIf(id, revision, fields) {
      const p = rows.get(id);
      if (!p || p.moderationRevision !== revision) return 0;
      Object.assign(p, fields, { updatedAt: nextDate() });
      return 1;
    },
    async updateModeration(id, fields) {
      const p = rows.get(id);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) p[k] = v;
      p.updatedAt = nextDate();
      return p;
    },
  };
}

// Validates every event with the shared contract, like shared/rabbitmq publish().
function fakePublisher() {
  const events = [];
  const pub = async (eventName, payload) => { events.push({ eventName, payload: validateEvent(eventName, payload) }); };
  pub.events = events;
  return pub;
}
const failingPublisher = async () => { throw new Error('RabbitMQ chưa connect()'); };

function fakeLogger() {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), error: (m) => lines.push(['error', m]), warn: (m) => lines.push(['warn', m]) };
}

const allowAll = { async assertAllowed() {} };
const tour = (id = 't1', props = {}) =>
  new Tour({ id, title: 'Phố cổ Hội An', description: 'Đi bộ phố cổ', originalLanguage: 'vi', authorId: 'u1',
    status: TOUR_STATUS.DRAFT, city: 'Hội An', duration: 90, updatedAt: nextDate(), ...props });
const place = (id, props = {}) =>
  new Place({ id, tourId: 't1', name: `Điểm ${id}`, description: 'Mô tả', lat: 15.877, lng: 108.326,
    sequence: Number(id.replace(/\D/g, '')) || 0, updatedAt: nextDate(), ...props });

function setup({ tours = [tour()], places = [], publish = fakePublisher() } = {}) {
  const tourRepo = fakeTourRepo(tours);
  const placeRepo = fakePlaceRepo(places);
  const logger = fakeLogger();
  const moderation = new EventModerationGateway({ publish, clock: () => new Date('2026-02-01T00:00:00.000Z') });
  const deps = { tourRepo, placeRepo, zoneChecker: allowAll, moderation, logger };
  return { tourRepo, placeRepo, logger, publish, moderation, deps };
}

// ---------- flag ----------

test('isModerationEnabled: default off, only "true" turns it on', () => {
  assert.equal(isModerationEnabled({}), false);
  assert.equal(isModerationEnabled({ MODERATION_EVENTS_ENABLED: 'false' }), false);
  assert.equal(isModerationEnabled({ MODERATION_EVENTS_ENABLED: 'true' }), true);
});

test('flag off: AddPlace keeps approved, PublishTour publishes directly and ignores place moderation', async () => {
  const { tourRepo, placeRepo } = setup({ places: [place('p0', { moderationStatus: 'checking' })] });
  const added = await new AddPlace({ tourRepo, placeRepo, zoneChecker: allowAll })
    .execute({ authorId: 'u1', tourId: 't1', name: 'A', description: 'x', lat: 15.8, lng: 108.3 });
  assert.equal(added.moderationStatus, 'approved');
  const res = await new PublishTour({ tourRepo, placeRepo }).execute({ authorId: 'u1', tourId: 't1' });
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  const r = await new GetPublishReadiness({ tourRepo, placeRepo }).execute({ authorId: 'u1', tourId: 't1' });
  assert.equal(r.checks.some((c) => c.key === 'placesModeration'), false);
});

// ---------- place.submitted ----------

test('flag on: AddPlace sets checking and emits a valid place.submitted', async () => {
  const s = setup();
  const images = Array.from({ length: 7 }, (_, i) => ({ url: `https://x.supabase.co/i${i}.jpg`, caption: i ? undefined : 'cổng' }));
  const out = await new AddPlace(s.deps).execute({
    authorId: 'u1', tourId: 't1', name: ' Chùa Cầu ', type: 'historical', description: 'd'.repeat(2500),
    lat: 15.877, lng: 108.326, images,
  });
  assert.equal(out.moderationStatus, 'checking');
  assert.equal(s.publish.events.length, 1);
  const { eventName, payload } = s.publish.events[0];
  assert.equal(eventName, EVENTS.PLACE_SUBMITTED);
  assert.equal(payload.placeId, out.id);
  assert.equal(payload.tourId, 't1');
  assert.equal(payload.contributorId, 'u1');
  assert.equal(payload.language, 'vi');
  assert.equal(payload.city, 'Hội An');
  assert.equal(payload.name, 'Chùa Cầu');
  assert.equal(payload.description.length, 2000); // cut to the contract limit
  assert.equal(payload.images.length, 5);
  assert.deepEqual(payload.images[0], { url: 'https://x.supabase.co/i0.jpg', caption: 'cổng' });
  assert.match(payload.revision, /Z$/);
  assert.equal(s.placeRepo.rows.get(out.id).moderationRevision, payload.revision);
});

test('flag on: UpdatePlace resubmits only when name/description/images change', async () => {
  const s = setup({ places: [place('p1', { moderationStatus: 'approved' })] });
  const uc = new UpdatePlace(s.deps);
  await uc.execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { lat: 15.9, type: 'food' } });
  await uc.execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { name: 'Điểm p1' } }); // same value
  assert.equal(s.publish.events.length, 0);
  assert.equal(s.placeRepo.rows.get('p1').moderationStatus, 'approved');

  const out = await uc.execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { description: 'Mô tả mới' } });
  assert.equal(out.moderationStatus, 'checking');
  assert.equal(s.publish.events.length, 1);
  assert.equal(s.publish.events[0].payload.description, 'Mô tả mới');
  assert.equal(s.publish.events[0].payload.lat, 15.9);
});

test('flag on: a publish failure does not fail the request; the place stays checking', async () => {
  const s = setup({ publish: failingPublisher });
  const out = await new AddPlace(s.deps)
    .execute({ authorId: 'u1', tourId: 't1', name: 'A', description: 'x', lat: 15.8, lng: 108.3 });
  assert.equal(out.moderationStatus, 'checking');
  assert.ok(s.logger.lines.some(([lvl, m]) => lvl === 'error' && m.includes('place.submitted not sent')));
});

// ---------- tour submit ----------

test('flag on: submit is blocked while a place is checking or rejected (D5)', async () => {
  for (const status of ['checking', 'rejected']) {
    const s = setup({ places: [place('p1'), place('p2', { moderationStatus: status })] });
    await assert.rejects(
      () => new PublishTour(s.deps).execute({ authorId: 'u1', tourId: 't1' }),
      (e) => e.status === 422 && e.missing.some((m) => m.key === 'placesModeration' && m.label.includes('Điểm p2')),
    );
    assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.DRAFT);
    assert.equal(s.publish.events.length, 0);
  }
});

test('flag on: GetPublishReadiness reports placesModeration', async () => {
  const s = setup({ places: [place('p1', { moderationStatus: 'checking' })] });
  const r = await new GetPublishReadiness(s.deps).execute({ authorId: 'u1', tourId: 't1' });
  assert.equal(r.ready, false);
  assert.equal(r.checks.find((c) => c.key === 'placesModeration').ok, false);
});

test('flag on: submit sets ai_checking and emits a valid tour.submitted (warning places allowed)', async () => {
  const s = setup({ places: [place('p2', { sequence: 1 }), place('p1', { sequence: 0, moderationStatus: 'warning', type: 'food' })] });
  const res = await new PublishTour(s.deps).execute({ authorId: 'u1', tourId: 't1' });
  assert.equal(res.changed, true);
  assert.equal(res.tour.status, TOUR_STATUS.AI_CHECKING);
  assert.equal(s.publish.events.length, 1);
  const { eventName, payload } = s.publish.events[0];
  assert.equal(eventName, EVENTS.TOUR_SUBMITTED);
  assert.equal(payload.tourId, 't1');
  assert.equal(payload.contributorId, 'u1');
  assert.equal(payload.title, 'Phố cổ Hội An');
  assert.equal(payload.type, 'walking');
  assert.equal(payload.durationMinutes, 90);
  assert.deepEqual(payload.places.map((p) => [p.placeId, p.sequence]), [['p1', 0], ['p2', 1]]);
  assert.equal(payload.places[0].type, 'food');
  assert.equal(s.tourRepo.rows.get('t1').moderationRevision, payload.revision);
});

// ---------- results ----------

async function submittedPlace(s, props = {}) {
  const out = await new AddPlace(s.deps)
    .execute({ authorId: 'u1', tourId: 't1', name: 'A', description: 'x', lat: 15.8, lng: 108.3, ...props });
  return { id: out.id, revision: s.publish.events.at(-1).payload.revision };
}
const reason = (message, source = 'ai') => ({ field: 'description', category: 'misleading', message, source, severity: 0.5 });

test('place results: passed -> approved, warning -> warning, rejected -> rejected with reasons', async () => {
  const s = setup();
  const uc = new ApplyModerationResult(s.deps);

  const a = await submittedPlace(s);
  let r = await uc.execute('place.ai_passed', validateEvent('place.ai_passed', { placeId: a.id, tourId: 't1', revision: a.revision }));
  assert.equal(r.status, 'approved');
  assert.equal(s.placeRepo.rows.get(a.id).moderationStatus, 'approved');

  const b = await submittedPlace(s);
  r = await uc.execute('place.ai_passed', { placeId: b.id, tourId: 't1', revision: b.revision, warning: true, reasons: [reason('Hơi quảng cáo')] });
  assert.equal(s.placeRepo.rows.get(b.id).moderationStatus, 'warning');
  assert.equal(s.placeRepo.rows.get(b.id).moderationReasons[0].message, 'Hơi quảng cáo');

  const c = await submittedPlace(s);
  await uc.execute('place.ai_rejected', { placeId: c.id, tourId: 't1', revision: c.revision, reason: 'Lừa đảo' });
  assert.equal(s.placeRepo.rows.get(c.id).moderationStatus, 'rejected');
  assert.equal(s.placeRepo.rows.get(c.id).moderationReasons[0].message, 'Lừa đảo');
});

test('place results: stale revision ignored; reorder or a non-content edit does not make it stale', async () => {
  const s = setup();
  const uc = new ApplyModerationResult(s.deps);
  const a = await submittedPlace(s);
  await submittedPlace(s);
  // Bumps updatedAt without new content: the pending result must still apply.
  await new ReorderPlaces(s.deps).execute({ authorId: 'u1', tourId: 't1', orderedIds: ['p2', 'p1'] });
  await new UpdatePlace(s.deps).execute({ authorId: 'u1', tourId: 't1', placeId: a.id, patch: { lat: 15.81 } });
  let r = await uc.execute('place.ai_passed', { placeId: a.id, tourId: 't1', revision: a.revision });
  assert.equal(r.applied, true);

  // Content edited after submit: the old result is stale.
  await new UpdatePlace(s.deps).execute({ authorId: 'u1', tourId: 't1', placeId: a.id, patch: { name: 'B' } });
  r = await uc.execute('place.ai_rejected', { placeId: a.id, tourId: 't1', revision: a.revision, reason: 'cũ' });
  assert.deepEqual(r, { applied: false, ignored: 'stale' });
  assert.equal(s.placeRepo.rows.get(a.id).moderationStatus, 'checking');

  r = await uc.execute('place.ai_passed', { placeId: 'ghost', tourId: 't1', revision: a.revision });
  assert.equal(r.ignored, 'not_found');
});

async function submittedTour(s) {
  await new PublishTour(s.deps).execute({ authorId: 'u1', tourId: 't1' });
  return s.publish.events.at(-1).payload.revision;
}

test('tour results: passed -> pending_review, warning -> ai_warning, rejected -> draft with reasons', async () => {
  const cases = [
    ['tour.ai_passed', {}, TOUR_STATUS.PENDING_REVIEW],
    ['tour.ai_passed', { warning: true, severity: 0.5, reasons: [reason('Chặng quá dài', 'geo')] }, TOUR_STATUS.AI_WARNING],
    ['tour.ai_rejected', { reason: 'Nội dung thù ghét', reasons: [reason('Nội dung thù ghét')] }, TOUR_STATUS.DRAFT],
  ];
  for (const [event, extra, expected] of cases) {
    const s = setup({ places: [place('p1')] });
    const revision = await submittedTour(s);
    const payload = validateEvent(event, { tourId: 't1', revision, ...extra });
    const r = await new ApplyModerationResult(s.deps).execute(event, payload);
    assert.equal(r.status, expected);
    const t = s.tourRepo.rows.get('t1');
    assert.equal(t.status, expected);
    assert.deepEqual(t.moderationReasons, extra.reasons ?? []);
    assert.deepEqual(t.toPublic().moderationReasons, extra.reasons ?? []);
  }
});

test('tour results: stale revision and tour not in ai_checking are ignored', async () => {
  const s = setup({ places: [place('p1')] });
  const revision = await submittedTour(s);
  const uc = new ApplyModerationResult(s.deps);
  let r = await uc.execute('tour.ai_passed', { tourId: 't1', revision: '2020-01-01T00:00:00.000Z' });
  assert.equal(r.ignored, 'stale');
  r = await uc.execute('tour.ai_passed', { tourId: 't1' });
  assert.equal(r.ignored, 'stale');
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.AI_CHECKING);

  await uc.execute('tour.ai_passed', { tourId: 't1', revision });
  r = await uc.execute('tour.ai_rejected', { tourId: 't1', revision, reason: 'muộn' }); // duplicate after apply
  assert.equal(r.ignored, 'not_checking');
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.PENDING_REVIEW);
});

// ---------- handler ----------

test('handler: queue + bindings; never throws on invalid payload or repository error', async () => {
  assert.equal(MODERATION_RESULT_QUEUE, 'tour.moderation-results');
  assert.deepEqual([...MODERATION_RESULT_BINDINGS].sort(),
    ['place.ai_passed', 'place.ai_rejected', 'tour.ai_passed', 'tour.ai_rejected']);

  const s = setup();
  const logger = fakeLogger();
  const ok = buildModerationResultHandler({ applyModerationResult: new ApplyModerationResult(s.deps), validateEvent, logger });
  await ok('place.ai_rejected', { placeId: 'p1' }); // missing keys -> zod error, logged
  await ok('place.ai_passed', { placeId: 'p1', tourId: 't1', revision: 'not-a-date' });

  const boom = buildModerationResultHandler({
    applyModerationResult: { async execute() { throw new Error('db down'); } }, validateEvent, logger,
  });
  await boom('tour.ai_passed', { tourId: 't1', revision: '2026-01-01T00:00:00.000Z' });
  assert.equal(logger.lines.filter(([lvl]) => lvl === 'error').length, 3);
});

// ---------- review fixes: withdraw on edit, conditional write, 50-place limit ----------

test('flag on: submit blocked when the tour has more than 50 places (placesLimit)', async () => {
  const places = Array.from({ length: 51 }, (_, i) => place(`p${i}`, { sequence: i }));
  const s = setup({ places });
  await assert.rejects(
    () => new PublishTour(s.deps).execute({ authorId: 'u1', tourId: 't1' }),
    (e) => e.status === 422 && e.missing.some((m) => m.key === 'placesLimit'),
  );
  assert.equal(s.publish.events.length, 0);
  const ok = setup({ places: places.slice(0, 50) });
  await new PublishTour(ok.deps).execute({ authorId: 'u1', tourId: 't1' });
  assert.equal(ok.publish.events[0].payload.places.length, 50);
});

const IN_MODERATION = [TOUR_STATUS.AI_CHECKING, TOUR_STATUS.AI_WARNING, TOUR_STATUS.PENDING_REVIEW];

test('flag on: UpdateTour content edit while in moderation -> draft, revision cleared', async () => {
  for (const status of IN_MODERATION) {
    const s = setup({ tours: [tour('t1', { status, moderationRevision: '2026-01-01T00:00:00.000Z' })] });
    const res = await new UpdateTour(s.deps).execute({ authorId: 'u1', tourId: 't1', patch: { title: 'Tên mới' } });
    assert.equal(res.tour.status, TOUR_STATUS.DRAFT);
    assert.equal(res.requiresResubmit, true);
    assert.equal(s.tourRepo.rows.get('t1').moderationRevision, null);
  }
  // Edit that the tour scan does not read (cover) or same value: no change.
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.AI_CHECKING, moderationRevision: 'r' })] });
  await new UpdateTour(s.deps).execute({ authorId: 'u1', tourId: 't1', patch: { coverImageUrl: 'https://x.co/c.jpg', city: 'Hội An' } });
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.AI_CHECKING);
});

test('flag off: UpdateTour while ai_checking keeps the status (unchanged behaviour)', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.AI_CHECKING })] });
  const res = await new UpdateTour({ tourRepo: s.tourRepo }).execute({ authorId: 'u1', tourId: 't1', patch: { title: 'X' } });
  assert.equal(res.tour.status, TOUR_STATUS.AI_CHECKING);
  assert.equal(res.requiresResubmit, false);
});

test('flag on: place add / delete / reorder / content or geo edit withdraws a tour in moderation', async () => {
  const actions = {
    add: (d) => new AddPlace(d).execute({ authorId: 'u1', tourId: 't1', name: 'N', description: 'x', lat: 15.8, lng: 108.3 }),
    delete: (d) => new DeletePlace(d).execute({ authorId: 'u1', tourId: 't1', placeId: 'p1' }),
    reorder: (d) => new ReorderPlaces(d).execute({ authorId: 'u1', tourId: 't1', orderedIds: ['p2', 'p1'] }),
    edit: (d) => new UpdatePlace(d).execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { description: 'Mới' } }),
    move: (d) => new UpdatePlace(d).execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { lat: 15.9 } }),
  };
  for (const [name, run] of Object.entries(actions)) {
    for (const status of IN_MODERATION) {
      const s = setup({ tours: [tour('t1', { status, moderationRevision: 'r' })], places: [place('p1', { sequence: 0 }), place('p2', { sequence: 1 })] });
      await run(s.deps);
      const t = s.tourRepo.rows.get('t1');
      assert.equal(t.status, TOUR_STATUS.DRAFT, `${name} from ${status}`);
      assert.equal(t.moderationRevision, null, `${name} from ${status}`);
    }
  }
  // Audio-only edit does not change what the tour scan reads.
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.PENDING_REVIEW })], places: [place('p1')] });
  await actions.edit({ ...s.deps, moderation: null }); // flag off: unchanged
  await new UpdatePlace(s.deps).execute({ authorId: 'u1', tourId: 't1', placeId: 'p1', patch: { audioUrl: 'https://x.co/a.mp3' } });
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.PENDING_REVIEW);
});

test('tour result after a withdraw (edit during ai_checking) is ignored', async () => {
  const s = setup({ places: [place('p1')] });
  const revision = await submittedTour(s);
  await new UpdateTour(s.deps).execute({ authorId: 'u1', tourId: 't1', patch: { description: 'Sửa' } });
  const r = await new ApplyModerationResult(s.deps).execute('tour.ai_passed', { tourId: 't1', revision });
  assert.equal(r.applied, false);
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.DRAFT);
});

test('conditional write: a change between the read and the write -> ignored, nothing written', async () => {
  const s = setup({ places: [place('p1')] });
  const tourRevision = await submittedTour(s);
  const a = await submittedPlace(s);
  // The check reads a matching entity, but the conditional UPDATE matches no row (concurrent edit).
  s.placeRepo.applyModerationResultIf = async () => 0;
  s.tourRepo.applyModerationResultIf = async () => 0;
  const uc = new ApplyModerationResult(s.deps);
  let r = await uc.execute('place.ai_passed', { placeId: a.id, tourId: 't1', revision: a.revision });
  assert.deepEqual(r, { applied: false, ignored: 'stale' });
  assert.equal(s.placeRepo.rows.get(a.id).moderationStatus, 'checking');
  // AddPlace withdrew the tour; put it back to ai_checking so only the write decides.
  Object.assign(s.tourRepo.rows.get('t1'), { status: TOUR_STATUS.AI_CHECKING, moderationRevision: tourRevision });
  r = await uc.execute('tour.ai_passed', { tourId: 't1', revision: tourRevision });
  assert.deepEqual(r, { applied: false, ignored: 'stale' });
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.AI_CHECKING);
});
