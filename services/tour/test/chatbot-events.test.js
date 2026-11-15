// =========================================================
// #240 — tour.published / tour.unpublished for the chatbot index, behind CHATBOT_EVENTS_ENABLED.
// Fakes only: no broker, no DB, no network. Published payloads are validated with the shared
// zod contract (loaded by test/helpers/shared-events.js).
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { Place } from '../src/domain/entities/place.js';
import { TourLanguage } from '../src/domain/entities/tour-language.js';
import { PlaceTranslation } from '../src/domain/entities/place-translation.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { UpdatePlace } from '../src/application/use-cases/update-place.js';
import { DeletePlace } from '../src/application/use-cases/delete-place.js';
import { ReorderPlaces } from '../src/application/use-cases/reorder-places.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { DeleteTour } from '../src/application/use-cases/delete-tour.js';
import { UpdateTranslation } from '../src/application/use-cases/update-translation.js';
import { PublishTour, UnpublishTour } from '../src/application/use-cases/publish-tour.js';
import { ApplyModerationResult } from '../src/application/use-cases/apply-moderation-result.js';
import { EventModerationGateway } from '../src/infrastructure/messaging/event-moderation-gateway.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { isChatbotEventsEnabled } from '../src/config.js';

// --- fakes (updatedAt moves forward on every write, like Prisma @updatedAt) ---
let tick = Date.parse('2026-01-01T00:00:00.000Z');
const nextDate = () => new Date((tick += 1000));
// The publisher clock also moves forward, so re-sends get a newer revision.
const clock = () => new Date((tick += 1000));

function fakeTourRepo(seed = []) {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async save(t) { t.updatedAt = nextDate(); rows.set(t.id, t); return t; },
    async delete(id) { rows.delete(id); },
    async updateModeration(id, fields) {
      const t = rows.get(id);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) t[k] = v;
      t.updatedAt = nextDate();
      return t;
    },
  };
}

function fakePlaceRepo(seed = []) {
  const rows = new Map(seed.map((p) => [p.id, p]));
  let seq = 100;
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
    async updateModeration(id, fields) {
      const p = rows.get(id);
      Object.assign(p, fields, { updatedAt: nextDate() });
      return p;
    },
  };
}

function fakeI18nRepos({ langs = [], translations = [] } = {}) {
  const tx = [...translations];
  return {
    tourLanguageRepo: { async listByTour() { return langs; } },
    placeTranslationRepo: {
      async listByTour() { return tx; },
      async findByPlaceLang(placeId, code) { return tx.find((t) => t.placeId === placeId && t.languageCode === code) ?? null; },
      async upsert(t) {
        const i = tx.findIndex((x) => x.placeId === t.placeId && x.languageCode === t.languageCode);
        if (i >= 0) tx[i] = t; else tx.push(t);
        return t;
      },
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
    type: 'walking', status: TOUR_STATUS.PUBLIC, city: 'Hội An', duration: 90, updatedAt: nextDate(), ...props });
const place = (id, props = {}) =>
  new Place({ id, tourId: 't1', name: `Điểm ${id}`, description: 'Mô tả', lat: 15.877, lng: 108.326,
    sequence: Number(id.replace(/\D/g, '')) || 0, updatedAt: nextDate(), ...props });

function setup({ tours = [tour()], places = [place('p1'), place('p2')], publish = fakePublisher(), flag = true, i18n = {}, moderation = false } = {}) {
  const tourRepo = fakeTourRepo(tours);
  const placeRepo = fakePlaceRepo(places);
  const logger = fakeLogger();
  const catalog = flag ? new EventTourCatalogPublisher({ publish, clock, logger }) : null;
  const deps = {
    tourRepo,
    placeRepo,
    zoneChecker: allowAll,
    catalog,
    moderation: moderation ? new EventModerationGateway({ publish, clock }) : null,
    logger,
    ...fakeI18nRepos(i18n),
  };
  const events = () => (publish.events ?? []).filter((e) => e.eventName.startsWith('tour.') && e.eventName !== 'tour.submitted');
  return { tourRepo, placeRepo, logger, publish, deps, events };
}
const who = { authorId: 'u1', tourId: 't1' };

// ---------- flag ----------

test('isChatbotEventsEnabled: default off, only "true" turns it on', () => {
  assert.equal(isChatbotEventsEnabled({}), false);
  assert.equal(isChatbotEventsEnabled({ CHATBOT_EVENTS_ENABLED: 'false' }), false);
  assert.equal(isChatbotEventsEnabled({ CHATBOT_EVENTS_ENABLED: 'TRUE' }), true);
  assert.equal(isChatbotEventsEnabled({ CHATBOT_EVENTS_ENABLED: 'true' }), true);
});

test('flag off: no transition publishes anything and behaviour is unchanged', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })], flag: false });
  const pub = await new PublishTour(s.deps).execute(who);
  assert.equal(pub.tour.status, TOUR_STATUS.PUBLIC);
  await new AddPlace(s.deps).execute({ ...who, name: 'A', description: 'x', lat: 15.8, lng: 108.3 });
  await new UpdateTour(s.deps).execute({ ...who, patch: { title: 'Mới' } });
  await new PublishTour(s.deps).execute(who);
  await new UnpublishTour(s.deps).execute(who);
  await new PublishTour(s.deps).execute(who);
  await new DeleteTour(s.deps).execute(who);
  assert.equal(s.publish.events.length, 0);
});

// ---------- payload ----------

test('tour.published payload matches the shared contract (cut, sorted, max 50, translations)', async () => {
  const publish = fakePublisher();
  const t = tour('t1', { description: 'd'.repeat(6000), duration: 75, city: '' });
  const places = Array.from({ length: 55 }, (_, i) =>
    place(`p${54 - i}`, { description: 'x'.repeat(2500), type: i % 2 ? 'food' : null }));
  const translations = [
    new PlaceTranslation({ placeId: 'p0', languageCode: 'en', text: 'Hello', textSource: 'machine' }),
    new PlaceTranslation({ placeId: 'p0', languageCode: 'vi', text: 'source copy', textSource: 'source' }),
  ];
  const langs = ['vi', 'en'];
  const payload = await new EventTourCatalogPublisher({ publish, clock })
    .publishTourPublished(t, places, { languages: langs, translations });

  assert.equal(publish.events.length, 1);
  assert.equal(publish.events[0].eventName, EVENTS.TOUR_PUBLISHED);
  assert.equal(payload.status, 'public');
  assert.equal(payload.language, 'vi');
  assert.equal(payload.type, 'walking');
  assert.equal(payload.durationMinutes, 75);
  assert.equal(payload.city, undefined);
  assert.equal(payload.description.length, 5000);
  assert.deepEqual(payload.languages, ['vi', 'en']);
  assert.equal(payload.places.length, 50);
  assert.deepEqual(payload.places.map((p) => p.sequence), Array.from({ length: 50 }, (_, i) => i));
  assert.equal(payload.places[0].description.length, 2000);
  assert.deepEqual(payload.places[0].translations, [{ language: 'en', text: 'Hello' }]); // source language skipped
  assert.equal(payload.places[1].translations, undefined);
  assert.match(payload.revision, /Z$/);
  assert.match(payload.at, /Z$/);
});

test('tour.published is skipped with a warning when the tour type is not in the contract', async () => {
  const publish = fakePublisher();
  const logger = fakeLogger();
  const out = await new EventTourCatalogPublisher({ publish, clock, logger })
    .publishTourPublished(tour('t1', { type: '' }), [place('p1')]);
  assert.equal(out, null);
  assert.equal(publish.events.length, 0);
  assert.ok(logger.lines.some(([lvl, m]) => lvl === 'warn' && m.includes('tour.published skipped (tourId=t1)')));
});

test('revision is never older than tour.updatedAt', async () => {
  const publish = fakePublisher();
  const future = new Date('2030-01-01T00:00:00.000Z');
  const out = await new EventTourCatalogPublisher({ publish, clock })
    .publishTourUnpublished(tour('t1', { updatedAt: future }), 'deleted');
  assert.equal(out.revision, future.toISOString());
});

// ---------- transitions ----------

test('PublishTour (direct publish): draft -> public sends a valid tour.published', async () => {
  const s = setup({
    tours: [tour('t1', { status: TOUR_STATUS.DRAFT })],
    i18n: { langs: [new TourLanguage({ tourId: 't1', languageCode: 'vi', isSource: true }), new TourLanguage({ tourId: 't1', languageCode: 'en' })] },
  });
  const res = await new PublishTour(s.deps).execute(who);
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  const ev = s.events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].eventName, EVENTS.TOUR_PUBLISHED);
  assert.equal(ev[0].payload.tourId, 't1');
  assert.deepEqual(ev[0].payload.places.map((p) => p.placeId), ['p1', 'p2']);
  assert.deepEqual(ev[0].payload.languages, ['vi', 'en']);
  assert.ok(ev[0].payload.revision >= s.tourRepo.rows.get('t1').updatedAt.toISOString());

  await new PublishTour(s.deps).execute(who); // already public: nothing changes, nothing sent
  assert.equal(s.events().length, 1);
});

test('PublishTour with moderation on: ai_checking is not public, no tour.published', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })], moderation: true });
  const res = await new PublishTour(s.deps).execute(who);
  assert.equal(res.tour.status, TOUR_STATUS.AI_CHECKING);
  assert.equal(s.events().length, 0);
});

test('UnpublishTour: public -> draft sends tour.unpublished (unpublished)', async () => {
  const s = setup();
  await new UnpublishTour(s.deps).execute(who);
  const ev = s.events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].eventName, EVENTS.TOUR_UNPUBLISHED);
  assert.equal(ev[0].payload.reason, 'unpublished');
  assert.match(ev[0].payload.revision, /Z$/);
});

test('UpdateTour: editing a public tour sends tour.unpublished (edited); a draft edit sends nothing', async () => {
  const s = setup();
  const res = await new UpdateTour(s.deps).execute({ ...who, patch: { title: 'Tên mới' } });
  assert.equal(res.requiresResubmit, true);
  assert.equal(res.tour.status, TOUR_STATUS.DRAFT);
  assert.deepEqual(s.events().map((e) => [e.eventName, e.payload.reason]), [[EVENTS.TOUR_UNPUBLISHED, 'edited']]);

  await new UpdateTour(s.deps).execute({ ...who, patch: { title: 'Tên khác' } }); // now draft
  assert.equal(s.events().length, 1);
});

test('DeleteTour: deleting a public tour sends tour.unpublished (deleted); a draft sends nothing', async () => {
  const s = setup({ tours: [tour('t1'), tour('t2', { status: TOUR_STATUS.DRAFT })] });
  await new DeleteTour(s.deps).execute(who);
  await new DeleteTour(s.deps).execute({ authorId: 'u1', tourId: 't2' });
  assert.deepEqual(s.events().map((e) => [e.eventName, e.payload.tourId, e.payload.reason]), [
    [EVENTS.TOUR_UNPUBLISHED, 't1', 'deleted'],
  ]);
});

test('place add / edit / delete / reorder on a public tour re-sends tour.published with a newer revision', async () => {
  const s = setup();
  const added = await new AddPlace(s.deps).execute({ ...who, name: 'Mới', description: 'x', lat: 15.8, lng: 108.3 });
  await new UpdatePlace(s.deps).execute({ ...who, placeId: 'p1', patch: { description: 'Sửa' } });
  await new ReorderPlaces(s.deps).execute({ ...who, orderedIds: [added.id, 'p2', 'p1'] });
  await new DeletePlace(s.deps).execute({ ...who, placeId: 'p2' });

  const ev = s.events();
  assert.deepEqual(ev.map((e) => e.eventName), Array(4).fill(EVENTS.TOUR_PUBLISHED));
  assert.equal(ev[0].payload.places.length, 3);
  assert.equal(ev[1].payload.places.find((p) => p.placeId === 'p1').description, 'Sửa');
  assert.deepEqual(ev[2].payload.places.map((p) => p.placeId), [added.id, 'p2', 'p1']);
  assert.deepEqual(ev[3].payload.places.map((p) => p.placeId), [added.id, 'p1']);
  const revisions = ev.map((e) => e.payload.revision);
  assert.deepEqual([...revisions].sort(), revisions);
  assert.equal(new Set(revisions).size, 4);
  assert.equal(s.tourRepo.rows.get('t1').status, TOUR_STATUS.PUBLIC);
});

test('place edits on a draft tour send nothing', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })] });
  await new AddPlace(s.deps).execute({ ...who, name: 'Mới', description: 'x', lat: 15.8, lng: 108.3 });
  await new UpdatePlace(s.deps).execute({ ...who, placeId: 'p1', patch: { description: 'Sửa' } });
  await new DeletePlace(s.deps).execute({ ...who, placeId: 'p2' });
  assert.equal(s.events().length, 0);
});

test('UpdateTranslation on a public tour re-sends tour.published with the translation', async () => {
  const s = setup({ i18n: { langs: [new TourLanguage({ tourId: 't1', languageCode: 'en', gender: 'female' })] } });
  const tts = { async synthesize() { return { url: null, prerendered: false }; } };
  await new UpdateTranslation({ ...s.deps, ttsSynthesizer: tts })
    .execute({ ...who, placeId: 'p1', lang: 'en', text: ' Old town ' });
  const ev = s.events();
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].payload.places[0].translations, [{ language: 'en', text: 'Old town' }]);
});

// ---------- failures ----------

test('a publish failure is logged and never fails the request', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })], publish: failingPublisher });
  const res = await new PublishTour(s.deps).execute(who);
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  await new AddPlace(s.deps).execute({ ...who, name: 'Mới', description: 'x', lat: 15.8, lng: 108.3 });
  const del = await new DeleteTour(s.deps).execute(who);
  assert.deepEqual(del, { id: 't1' });
  const errors = s.logger.lines.filter(([lvl]) => lvl === 'error').map(([, m]) => m);
  assert.equal(errors.filter((m) => m.startsWith('[tour] tour.published not sent (tourId=t1)')).length, 2);
  assert.equal(errors.filter((m) => m.startsWith('[tour] tour.unpublished not sent (tourId=t1)')).length, 1);
});

test('an invalid payload rejected by the contract is logged, the request still succeeds', async () => {
  const s = setup({ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })], places: [place('p1', { lat: 200 })] });
  const res = await new PublishTour(s.deps).execute(who);
  assert.equal(res.tour.status, TOUR_STATUS.PUBLIC);
  assert.equal(s.events().length, 0);
  assert.ok(s.logger.lines.some(([lvl, m]) => lvl === 'error' && m.includes('tour.published not sent')));
});

// ---------- moderation on: only moderated places reach the chatbot ----------

test('tour.published leaves out places still checking or rejected by AI moderation', async () => {
  const s = setup({
    places: [
      place('p1'),
      place('p2', { moderationStatus: 'checking' }),
      place('p3', { moderationStatus: 'rejected' }),
      place('p4', { moderationStatus: 'warning' }),
    ],
  });
  await new UnpublishTour(s.deps).execute(who);
  await new PublishTour(s.deps).execute(who);
  const [published] = s.events().filter((e) => e.eventName === EVENTS.TOUR_PUBLISHED);
  assert.deepEqual(published.payload.places.map((p) => p.placeId), ['p1', 'p4']);
});

test('ApplyModerationResult: an approved place of a public tour re-sends tour.published with it', async () => {
  const s = setup({ places: [place('p1'), place('p2', { moderationStatus: 'checking', moderationRevision: 'r2' })] });
  s.placeRepo.applyModerationResultIf = async (id, revision, fields) => {
    const p = s.placeRepo.rows.get(id);
    if (p.moderationRevision !== revision) return 0;
    Object.assign(p, fields);
    return 1;
  };
  const apply = new ApplyModerationResult(s.deps);
  const res = await apply.execute('place.ai_passed', { placeId: 'p2', tourId: 't1', revision: 'r2' });
  assert.equal(res.applied, true);
  const [published] = s.events();
  assert.equal(published.eventName, EVENTS.TOUR_PUBLISHED);
  assert.deepEqual(published.payload.places.map((p) => p.placeId), ['p1', 'p2']);
});

test('ApplyModerationResult: a place result on a draft tour, or without the flag, sends nothing', async () => {
  for (const opts of [{ tours: [tour('t1', { status: TOUR_STATUS.DRAFT })] }, { flag: false }]) {
    const s = setup({ ...opts, places: [place('p2', { moderationStatus: 'checking', moderationRevision: 'r2' })] });
    s.placeRepo.applyModerationResultIf = async () => 1;
    await new ApplyModerationResult(s.deps).execute('place.ai_passed', { placeId: 'p2', tourId: 't1', revision: 'r2' });
    assert.equal(s.events().length, 0);
  }
});
