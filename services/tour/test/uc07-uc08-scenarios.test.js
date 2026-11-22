// =========================================================
// Use-case scenarios: UC07 (personal itinerary: create, add, reorder, remove, share, delete) ->
// UC08 (follow an itinerary, owner and shared link). Each test chains the real use cases, so a
// regression between two steps is caught (single steps are covered by itinerary.test.js).
// UC08 playback (GPS, audio, progress) lives in the client; only the backend view it reads
// (GetItinerary / GetSharedItinerary -> buildItineraryView) is covered here.
// UC07/UC08 publish no event; the tour.unpublished / tour.hidden events of the "tour leaves
// public later" steps go through the shared zod contract (test/helpers/shared-events.js).
// Fakes only: in-memory repositories, no DB, no broker, no network.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { Itinerary } from '../src/domain/entities/itinerary.js';
import { ItineraryItem } from '../src/domain/entities/itinerary-item.js';
import { Place } from '../src/domain/entities/place.js';
import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import { CreateItinerary } from '../src/application/use-cases/create-itinerary.js';
import { ListMyItineraries } from '../src/application/use-cases/list-my-itineraries.js';
import { GetItinerary } from '../src/application/use-cases/get-itinerary.js';
import { RenameItinerary } from '../src/application/use-cases/rename-itinerary.js';
import { DeleteItinerary } from '../src/application/use-cases/delete-itinerary.js';
import { AddItineraryItem } from '../src/application/use-cases/add-itinerary-item.js';
import { RemoveItineraryItem } from '../src/application/use-cases/remove-itinerary-item.js';
import { ReorderItineraryItems } from '../src/application/use-cases/reorder-itinerary-items.js';
import { ShareItinerary } from '../src/application/use-cases/share-itinerary.js';
import { GetSharedItinerary } from '../src/application/use-cases/get-shared-itinerary.js';
import { UnpublishTour } from '../src/application/use-cases/publish-tour.js';
import { HideReportedTour } from '../src/application/use-cases/admin-reports.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { EventAdminReportPublisher } from '../src/infrastructure/messaging/event-admin-report-publisher.js';

let tick = Date.parse('2026-04-01T00:00:00.000Z');
const clock = () => new Date((tick += 1000));
const OWNER = 'u-owner';
const OTHER = 'u-other';
const AUTHOR = 'author-1';

// Same fake as itinerary.test.js: ids are given on save, items are re-sequenced like the Prisma repo.
function fakeItineraryRepo() {
  const store = new Map();
  let n = 0;
  const gid = (p) => `${p}-${++n}`;
  const clone = (rec) => JSON.parse(JSON.stringify(rec));
  const toEntity = (rec) => new Itinerary({ ...clone(rec), items: clone(rec).items.map((i) => new ItineraryItem(i)) });
  const itemsFrom = (it, id) =>
    it.items.map((x, idx) => ({ ...x.toPublic(), id: x.id ?? gid('item'), itineraryId: id, sequence: idx }));
  return {
    rows: store,
    async create(it) {
      const id = gid('itin');
      const rec = { id, ownerId: it.ownerId, name: it.name, shareToken: it.shareToken ?? null, items: itemsFrom(it, id) };
      store.set(id, rec);
      return toEntity(rec);
    },
    async findById(id) { const rec = store.get(id); return rec ? toEntity(rec) : null; },
    async findByShareToken(token) {
      for (const rec of store.values()) if (rec.shareToken === token) return toEntity(rec);
      return null;
    },
    async listByOwner(ownerId) { return [...store.values()].filter((r) => r.ownerId === ownerId).map(toEntity); },
    async save(it) {
      const rec = store.get(it.id);
      Object.assign(rec, { name: it.name, shareToken: it.shareToken, items: itemsFrom(it, it.id) });
      return toEntity(rec);
    },
    async delete(id) { store.delete(id); },
  };
}

// Tours and places as Tour sees them; the tour status moves through the real use cases below.
function fakeCatalog() {
  const tour = (id, status, title) =>
    new Tour({ id, title, originalLanguage: 'vi', status, authorId: AUTHOR, city: 'Hội An', type: 'walking', updatedAt: clock() });
  const tours = new Map([
    ['t-a', tour('t-a', TOUR_STATUS.PUBLIC, 'Phố cổ')],
    ['t-b', tour('t-b', TOUR_STATUS.PUBLIC, 'Ven sông')],
    ['t-restricted', tour('t-restricted', TOUR_STATUS.RESTRICTED, 'Thử nghiệm')],
    ['t-draft', tour('t-draft', TOUR_STATUS.DRAFT, 'Nháp')],
    ['t-pending', tour('t-pending', TOUR_STATUS.PENDING_REVIEW, 'Chờ duyệt')],
    ['t-hidden', tour('t-hidden', TOUR_STATUS.HIDDEN, 'Đã ẩn')],
  ]);
  const place = (id, tourId, name, lat, lng, extra = {}) =>
    new Place({ id, tourId, name, type: 'historical', description: `Mô tả ${name}`, lat, lng, audioSource: 'tts', ...extra });
  const places = new Map(
    [
      place('p-bridge', 't-a', 'Chùa Cầu', 15.8771, 108.3262, { audioSource: 'human', audioUrl: 'https://a/bridge.mp3', images: [{ url: 'https://i/bridge.jpg' }] }),
      place('p-house', 't-a', 'Nhà cổ Tấn Ký', 15.8768, 108.3291),
      place('p-river', 't-b', 'Bến sông Hoài', 15.8759, 108.3305),
      place('p-restricted', 't-restricted', 'Điểm thử', 15.88, 108.33),
      place('p-draft', 't-draft', 'Điểm nháp', 15.88, 108.33),
      place('p-pending', 't-pending', 'Điểm chờ', 15.88, 108.33),
      place('p-hidden', 't-hidden', 'Điểm ẩn', 15.88, 108.33),
    ].map((p) => [p.id, p]),
  );
  return {
    tours,
    places,
    tourRepo: {
      async findById(id) { return tours.get(id) ?? null; },
      async save(t) { t.updatedAt = clock(); tours.set(t.id, t); return t; },
    },
    placeRepo: {
      async findById(id) { return places.get(id) ?? null; },
      async listByTour(tourId) { return [...places.values()].filter((p) => p.tourId === tourId); },
    },
    tourLanguageRepo: { async listByTour() { return [{ languageCode: 'vi' }, { languageCode: 'en' }]; } },
    placeTranslationRepo: {
      async listByTour(tourId) {
        return tourId === 't-a' ? [{ placeId: 'p-bridge', languageCode: 'en', text: 'Japanese Bridge', ttsUrl: 'https://tts/en/bridge.mp3' }] : [];
      },
    },
    // Same contract as PrismaAdminReportRepository.hideIf: only public -> hidden.
    adminReportRepo: {
      async hideIf(id) {
        const t = tours.get(id);
        if (!t || t.status !== TOUR_STATUS.PUBLIC) return null;
        Object.assign(t, { status: TOUR_STATUS.HIDDEN, updatedAt: clock() });
        return { fromStatus: 'public', reportCount: 3 };
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

// Wiring of container.js (itineraryUseCases, plus the tour decisions that take a tour out of public).
function world() {
  const catalog = fakeCatalog();
  const itineraryRepo = fakeItineraryRepo();
  const publish = fakePublisher();
  const errors = [];
  const logger = { info() {}, warn() {}, error: (m) => errors.push(m) };
  let tokens = 0;
  const deps = {
    ...catalog,
    itineraryRepo,
    catalog: new EventTourCatalogPublisher({ publish, clock, logger }),
    adminReportEvents: new EventAdminReportPublisher({ publish, clock }),
    generateToken: () => `share-${++tokens}`,
    logger,
  };
  const uc = {
    create: new CreateItinerary(deps),
    list: new ListMyItineraries(deps),
    get: new GetItinerary(deps),
    rename: new RenameItinerary(deps),
    remove: new DeleteItinerary(deps),
    add: new AddItineraryItem(deps),
    removeItem: new RemoveItineraryItem(deps),
    reorder: new ReorderItineraryItems(deps),
    share: new ShareItinerary(deps),
    shared: new GetSharedItinerary(deps),
    unpublish: new UnpublishTour(deps),
    hide: new HideReportedTour(deps),
  };
  return { ...catalog, itineraryRepo, publish, errors, uc };
}

const is = (status, code) => (e) => e.status === status && (!code || e.code === code);

// Owner builds a three-stop itinerary over two public tours; returns its id and item ids.
async function buildTrip(w, ownerId = OWNER) {
  const { id } = await w.uc.create.execute({ ownerId, name: '  Hội An một ngày  ' });
  await w.uc.add.execute({ ownerId, itineraryId: id, placeId: 'p-bridge' });
  await w.uc.add.execute({ ownerId, itineraryId: id, placeId: 'p-house' });
  const view = await w.uc.add.execute({ ownerId, itineraryId: id, placeId: 'p-river' });
  return { id, view, itemIds: view.places.map((p) => p.id) };
}

test('UC07 journey: create -> add stops from two public tours -> view and "my itineraries" list', async () => {
  const w = world();
  const { id, view } = await buildTrip(w);
  assert.equal(view.name, 'Hội An một ngày');
  assert.deepEqual(view.places.map((p) => p.placeId), ['p-bridge', 'p-house', 'p-river']);
  assert.deepEqual(view.places.map((p) => p.sequence), [0, 1, 2]);
  assert.ok(view.distanceMeters > 0);
  assert.equal(view.legMeters.length, 2);
  assert.equal(view.shareToken, null);
  const stored = w.itineraryRepo.rows.get(id).items.map((i) => i.tourId);
  assert.deepEqual(stored, ['t-a', 't-a', 't-b']); // R4: the snapshot keeps its source tour

  const [mine] = await w.uc.list.execute({ ownerId: OWNER });
  assert.equal(mine.id, id);
  assert.equal(mine.placeCount, 3);
  assert.equal(mine.coverImageUrl, 'https://i/bridge.jpg');
  assert.deepEqual(await w.uc.list.execute({ ownerId: OTHER }), []);
  assert.deepEqual(w.publish.events, []); // UC07 publishes no event
});

test('UC07 R3: places of restricted, draft, pending or hidden tours are refused; the itinerary is unchanged', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  for (const placeId of ['p-restricted', 'p-draft', 'p-pending', 'p-hidden', 'p-ghost']) {
    await assert.rejects(() => w.uc.add.execute({ ownerId: OWNER, itineraryId: id, placeId }), is(404, 'place_not_addable'), placeId);
  }
  const view = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  assert.equal(view.placeCount, 3);
});

test('UC07 A2: reorder then remove keep a contiguous order; path, zones and distance follow it', async () => {
  const w = world();
  const { id, itemIds: [a, b, c], view: before } = await buildTrip(w);
  let view = await w.uc.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [c, a, b] });
  assert.deepEqual(view.places.map((p) => p.id), [c, a, b]);
  assert.deepEqual(view.route.triggers.map((t) => t.placeId), [c, a, b]);
  assert.deepEqual(view.route.path[0], { lat: 15.8759, lng: 108.3305 });
  assert.notEqual(view.distanceMeters, before.distanceMeters);

  await assert.rejects(() => w.uc.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [c, a] }), is(400));
  await assert.rejects(() => w.uc.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [c, a, 'ghost'] }), is(400));

  view = await w.uc.removeItem.execute({ ownerId: OWNER, itineraryId: id, itemId: a });
  assert.deepEqual(view.places.map((p) => [p.id, p.sequence]), [[c, 0], [b, 1]]);
  assert.equal(view.legMeters.length, 1);
  await assert.rejects(() => w.uc.removeItem.execute({ ownerId: OWNER, itineraryId: id, itemId: a }), is(404));

  // The change is stored: a fresh read gives the same order.
  const again = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  assert.deepEqual(again.places.map((p) => p.id), [c, b]);
});

test('UC07 A4: share gives one token, reused; the anonymous link shows the same stops, read-only', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  const s1 = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  const s2 = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  assert.deepEqual(s1, { id, shareToken: 'share-1', shared: true });
  assert.equal(s2.shareToken, 'share-1'); // R6: generated once

  const owner = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  const shared = await w.uc.shared.execute({ token: 'share-1' });
  assert.equal(shared.shared, true);
  assert.equal('ownerId' in shared, false); // the public link does not carry the owner's id
  assert.equal(owner.ownerId, OWNER);
  assert.deepEqual(shared.places, owner.places);
  assert.deepEqual(shared.route, owner.route);

  // The token is not an itinerary id: it opens nothing on the owner routes.
  await assert.rejects(() => w.uc.get.execute({ ownerId: OWNER, itineraryId: 'share-1' }), is(404));
  await assert.rejects(() => w.uc.shared.execute({ token: 'share-x' }), is(404));
});

test('UC07 R1: an anonymous viewer holding the link cannot change the itinerary (no owner -> 403)', async () => {
  const w = world();
  const { id, itemIds } = await buildTrip(w);
  const { shareToken } = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  const anon = { ownerId: undefined, itineraryId: (await w.uc.shared.execute({ token: shareToken })).id };
  assert.equal(anon.itineraryId, id);

  const attempts = [
    () => w.uc.get.execute(anon),
    () => w.uc.rename.execute({ ...anon, name: 'Hijack' }),
    () => w.uc.add.execute({ ...anon, placeId: 'p-bridge' }),
    () => w.uc.reorder.execute({ ...anon, orderedIds: [...itemIds].reverse() }),
    () => w.uc.removeItem.execute({ ...anon, itemId: itemIds[0] }),
    () => w.uc.share.execute({ ...anon, enabled: false }),
    () => w.uc.remove.execute(anon),
  ];
  for (const run of attempts) await assert.rejects(run, is(403, 'not_itinerary_owner'));

  const after = await w.uc.shared.execute({ token: shareToken });
  assert.equal(after.name, 'Hội An một ngày');
  assert.deepEqual(after.places.map((p) => p.id), itemIds);
});

test('UC07 R1: another signed-in user cannot read, edit, share or delete it', async () => {
  const w = world();
  const { id, itemIds } = await buildTrip(w);
  const other = { ownerId: OTHER, itineraryId: id };
  const attempts = [
    () => w.uc.get.execute(other),
    () => w.uc.rename.execute({ ...other, name: 'Của tôi' }),
    () => w.uc.add.execute({ ...other, placeId: 'p-river' }),
    () => w.uc.reorder.execute({ ...other, orderedIds: [...itemIds].reverse() }),
    () => w.uc.removeItem.execute({ ...other, itemId: itemIds[1] }),
    () => w.uc.share.execute(other),
    () => w.uc.remove.execute(other),
  ];
  for (const run of attempts) await assert.rejects(run, is(403, 'not_itinerary_owner'));

  const view = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  assert.equal(view.name, 'Hội An một ngày');
  assert.deepEqual(view.places.map((p) => p.id), itemIds);
  assert.equal(view.shareToken, null);
  await assert.rejects(() => w.uc.get.execute({ ownerId: OTHER, itineraryId: 'ghost' }), is(404));
});

test('UC07 A4: revoke closes the old link; sharing again makes a new token', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  const off = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id, enabled: false });
  assert.deepEqual(off, { id, shareToken: null, shared: false });
  await assert.rejects(() => w.uc.shared.execute({ token: 'share-1' }), is(404));

  const on = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  assert.equal(on.shareToken, 'share-2');
  await assert.rejects(() => w.uc.shared.execute({ token: 'share-1' }), is(404));
  assert.equal((await w.uc.shared.execute({ token: 'share-2' })).placeCount, 3);
});

test('UC07: the owner deletes the itinerary -> owner view and shared link are gone', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  const { shareToken } = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  assert.deepEqual(await w.uc.remove.execute({ ownerId: OWNER, itineraryId: id }), { id, deleted: true });
  await assert.rejects(() => w.uc.get.execute({ ownerId: OWNER, itineraryId: id }), is(404));
  await assert.rejects(() => w.uc.shared.execute({ token: shareToken }), is(404));
  assert.deepEqual(await w.uc.list.execute({ ownerId: OWNER }), []);
});

test('UC07 R4: the author unpublishes a tour later -> its stops stay (snapshot), new adds from it are refused', async () => {
  const w = world();
  const { id, view: before } = await buildTrip(w);
  const { shareToken } = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  w.places.get('p-bridge').description = 'Changed by the author after the add';

  await w.uc.unpublish.execute({ authorId: AUTHOR, tourId: 't-a' });
  assert.equal(w.tours.get('t-a').status, TOUR_STATUS.DRAFT);
  assert.deepEqual(w.publish.events.map((e) => e.eventName), [EVENTS.TOUR_UNPUBLISHED]);
  assert.equal(w.publish.events[0].payload.reason, 'unpublished');
  assert.deepEqual(w.errors, []);

  const owner = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  const shared = await w.uc.shared.execute({ token: shareToken });
  for (const view of [owner, shared]) {
    assert.deepEqual(view.places, before.places);
    assert.equal(view.places[0].text, 'Mô tả Chùa Cầu');
  }
  await assert.rejects(() => w.uc.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-house' }), is(404, 'place_not_addable'));
});

test('UC07 R4: an admin hides a reported tour later -> the itinerary keeps its stops, the tour is no longer addable', async () => {
  const w = world();
  const { id, itemIds } = await buildTrip(w);
  await w.uc.hide.execute({ tourId: 't-b', adminId: 'admin-1', reason: 'Nhiều báo cáo sai sự thật' });
  assert.equal(w.tours.get('t-b').status, TOUR_STATUS.HIDDEN);
  assert.deepEqual(w.publish.events.map((e) => e.eventName), [EVENTS.TOUR_HIDDEN, EVENTS.TOUR_UNPUBLISHED]);
  assert.equal(w.publish.events[1].payload.reason, 'hidden');
  assert.deepEqual(w.errors, []);

  const view = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  assert.deepEqual(view.places.map((p) => p.id), itemIds);
  assert.equal(view.places[2].placeId, 'p-river');
  await assert.rejects(() => w.uc.add.execute({ ownerId: OWNER, itineraryId: id, placeId: 'p-river' }), is(404, 'place_not_addable'));
  // The owner can still clean it up by hand.
  const after = await w.uc.removeItem.execute({ ownerId: OWNER, itineraryId: id, itemId: itemIds[2] });
  assert.equal(after.placeCount, 2);
});

test('UC08 follow (owner): stops in order with what the player needs (circle zones, path, audio)', async () => {
  const w = world();
  const { id, itemIds: [a, b, c] } = await buildTrip(w);
  await w.uc.reorder.execute({ ownerId: OWNER, itineraryId: id, orderedIds: [b, a, c] });
  const view = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });

  assert.equal(view.isItinerary, true);
  assert.equal(view.title, view.name); // the UC04 player reads `title`
  assert.deepEqual(view.places.map((p) => p.id), [b, a, c]);
  assert.deepEqual(view.route.path, view.places.map((p) => ({ lat: p.lat, lng: p.lng })));
  assert.deepEqual(view.route.navAudios, []); // R2: no navigation audio
  view.route.triggers.forEach((t, i) => {
    const p = view.places[i];
    assert.equal(t.placeId, p.id);
    assert.deepEqual(t.zone, { shape: 'circle', center: { lat: p.lat, lng: p.lng }, radiusMeters: 50 });
    assert.equal(t.priority, 0);
  });
  const bridge = view.places.find((p) => p.placeId === 'p-bridge');
  assert.deepEqual(
    { audioSource: bridge.audioSource, audioUrl: bridge.audioUrl, text: bridge.text, images: bridge.images },
    { audioSource: 'human', audioUrl: 'https://a/bridge.mp3', text: 'Mô tả Chùa Cầu', images: [{ url: 'https://i/bridge.jpg' }] },
  );
  const house = view.places.find((p) => p.placeId === 'p-house');
  assert.deepEqual([house.audioSource, house.audioUrl, house.text], ['tts', null, 'Mô tả Nhà cổ Tấn Ký']); // R3: device voice
});

test('UC08 R7 language: ?lang=en gives the translation, an unknown language falls back to the first one', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  const en = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id, lang: 'en' });
  assert.deepEqual(en.availableLanguages, ['vi', 'en']);
  assert.equal(en.selectedLanguage, 'en');
  const bridge = en.places.find((p) => p.placeId === 'p-bridge');
  assert.deepEqual([bridge.text, bridge.audioUrl, bridge.audioSource], ['Japanese Bridge', 'https://tts/en/bridge.mp3', 'tts']);
  const river = en.places.find((p) => p.placeId === 'p-river');
  assert.equal(river.text, 'Mô tả Bến sông Hoài'); // no translation -> source text

  const ja = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id, lang: 'ja' });
  assert.equal(ja.selectedLanguage, 'vi');
  assert.equal(ja.places[0].audioUrl, 'https://a/bridge.mp3');
});

test('UC08 A2 follow a shared link: same stops and zones as the owner, language picked on the link', async () => {
  const w = world();
  const { id } = await buildTrip(w);
  const { shareToken } = await w.uc.share.execute({ ownerId: OWNER, itineraryId: id });
  const owner = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id, lang: 'en' });
  const shared = await w.uc.shared.execute({ token: shareToken, lang: 'en' });
  assert.equal(shared.selectedLanguage, 'en');
  assert.deepEqual(shared.places, owner.places);
  assert.deepEqual(shared.route, owner.route);
  assert.equal(shared.walkingMinutes, owner.walkingMinutes);

  // Owner revokes the link while the friend is about to start: the player source is gone.
  await w.uc.share.execute({ ownerId: OWNER, itineraryId: id, enabled: false });
  await assert.rejects(() => w.uc.shared.execute({ token: shareToken, lang: 'en' }), is(404));
});

test('UC08 empty itinerary: the view is empty but valid (no zones, zero distance)', async () => {
  const w = world();
  const { id } = await w.uc.create.execute({ ownerId: OWNER, name: 'Trống' });
  const view = await w.uc.get.execute({ ownerId: OWNER, itineraryId: id });
  assert.deepEqual(
    [view.placeCount, view.route.triggers, view.route.path, view.distanceMeters, view.availableLanguages],
    [0, [], [], 0, ['vi']],
  );
});
