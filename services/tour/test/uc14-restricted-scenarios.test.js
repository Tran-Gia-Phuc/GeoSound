// =========================================================
// Use-case scenarios: UC14 (restricted access with a passcode), with the UC15 / UC19 steps the
// author uses to make the tour public again (A4) and the UC02 / UC03 / UC07 public reads it must
// never appear in. Each test chains the real use cases of the journey: author restricts -> hidden
// from search / nearby / explore / detail / package / catalog -> tester unlocks (wrong code 403,
// rate limit 429) -> detail and offline package for that account only -> passcode change
// invalidates the unlock -> restricted mode off -> submit -> approve -> public.
// Fakes only: one in-memory store per scenario (same semantics as the Prisma repositories), no DB,
// no broker, no network. Every published payload goes through the shared zod contract.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { validateEvent, EVENTS } from './helpers/shared-events.js';
import { TOUR_STATUS } from '../src/domain/entities/tour.js';
import { TourReviewAction } from '../src/domain/entities/tour-review-action.js';
import { UNLOCK_MAX_FAILURES, UNLOCK_WINDOW_MS } from '../src/domain/tour/restricted-access.js';
import { ScryptPasscodeHasher } from '../src/infrastructure/security/scrypt-passcode-hasher.js';
import { CreateTour } from '../src/application/use-cases/create-tour.js';
import { AddPlace } from '../src/application/use-cases/add-place.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { PublishTour } from '../src/application/use-cases/publish-tour.js';
import { ApplyModerationResult } from '../src/application/use-cases/apply-moderation-result.js';
import { ApproveTour, RejectTour } from '../src/application/use-cases/review-tour.js';
import { SearchTours } from '../src/application/use-cases/search-tours.js';
import { ExplorePlaces } from '../src/application/use-cases/explore-places.js';
import { GetPublicTour } from '../src/application/use-cases/get-public-tour.js';
import { GetTourPackage } from '../src/application/use-cases/get-tour-package.js';
import { ReportTour } from '../src/application/use-cases/tour-reports.js';
import { SaveMyTourRating } from '../src/application/use-cases/tour-ratings.js';
import {
  GetTourAccess, SetTourPasscode, DisableTourAccess, UnlockTour, GetMyTourAccess,
  GetRestrictedTour, GetRestrictedTourPackage,
} from '../src/application/use-cases/tour-access.js';
import { EventModerationGateway } from '../src/infrastructure/messaging/event-moderation-gateway.js';
import { EventTourCatalogPublisher } from '../src/infrastructure/messaging/event-tour-catalog-publisher.js';
import { EventTourReviewPublisher } from '../src/infrastructure/messaging/event-tour-review-publisher.js';
import { PrismaTourRepository } from '../src/infrastructure/persistence/prisma-tour-repository.js';
import { PrismaPlaceRepository } from '../src/infrastructure/persistence/prisma-place-repository.js';
import { buildModerationResultHandler } from '../src/interfaces/events/moderation-result-handler.js';
import { TourAccessController } from '../src/interfaces/http/controllers/tour-access-controller.js';
import { buildTourAccessRouter } from '../src/interfaces/http/routes/tour-access-routes.js';

const AUTHOR = 'author-1';
const TESTER = 'tester-1';
const CODE = 'Thu2026';
const NEW_CODE = 'MaMoi2026';
const ME = { lat: 15.877, lng: 108.326 }; // next to the tour's first place
// The public filters the Prisma repositories really use (status public only).
const PUBLIC_TOUR = PrismaTourRepository.publicWhere({}).status;
const PUBLIC_PLACE_TOUR = PrismaPlaceRepository.publicPlaceWhere({}).tour.is.status;

function world() {
  let now = Date.parse('2026-11-04T08:00:00.000Z');
  const clock = () => new Date((now += 1000)); // every write moves updatedAt forward
  const tours = new Map();
  const places = new Map();
  const reviewLog = [];
  const patch = (row, fields) => Object.assign(row, fields, { updatedAt: clock() });
  const isPublicMatch = (t, { q, city } = {}) =>
    t.status === PUBLIC_TOUR
    && (!q || `${t.title} ${t.description}`.toLowerCase().includes(q.toLowerCase()))
    && (!city || (t.city ?? '').toLowerCase() === city.toLowerCase());
  const placesOf = (tourId) => [...places.values()].filter((p) => p.tourId === tourId).sort((a, b) => a.sequence - b.sequence);

  const tourRepo = {
    rows: tours,
    async create(t) { Object.assign(t, { id: crypto.randomUUID(), createdAt: clock(), updatedAt: clock() }); tours.set(t.id, t); return t; },
    async findById(id) { return tours.get(id) ?? null; },
    async findPublicById(id) { const t = tours.get(id); return t?.isPublic() ? t : null; },
    async save(t) { t.updatedAt = clock(); tours.set(t.id, t); return t; },
    async updateModeration(id, fields) { return patch(tours.get(id), fields); },
    async applyModerationResultIf(id, revision, fields) {
      const t = tours.get(id);
      if (!t || t.status !== TOUR_STATUS.AI_CHECKING || t.moderationRevision !== revision) return 0;
      patch(t, fields);
      return 1;
    },
    async applyReviewDecisionIf(id, fromStatuses, { status, reviewReason }, entry) {
      const t = tours.get(id);
      if (!t || !fromStatuses.includes(t.status)) return 0;
      patch(t, { status, reviewReason });
      reviewLog.push(new TourReviewAction({ id: `r${reviewLog.length + 1}`, tourId: id, ...entry, createdAt: clock() }));
      return 1;
    },
    // UC02 search / nearby
    async countPublic(f) { return [...tours.values()].filter((t) => isPublicMatch(t, f)).length; },
    async searchPublicPage(f, { skip, take }) { return [...tours.values()].filter((t) => isPublicMatch(t, f)).slice(skip, skip + take); },
    async listPublicIds(f) { return [...tours.values()].filter((t) => isPublicMatch(t, f)).map((t) => t.id); },
    async findManyByIds(ids) { return ids.map((id) => tours.get(id)).filter((t) => t?.status === PUBLIC_TOUR); },
  };

  const publicPlaces = () => [...places.values()].filter((p) => tours.get(p.tourId)?.status === PUBLIC_PLACE_TOUR);
  const placeRepo = {
    rows: places,
    async create(p) { p.id = crypto.randomUUID(); p.updatedAt = clock(); places.set(p.id, p); return p; },
    async findById(id) { return places.get(id) ?? null; },
    async listByTour(tourId) { return placesOf(tourId); },
    async save(p) { p.updatedAt = clock(); places.set(p.id, p); return p; },
    async nextSequence(tourId) { return placesOf(tourId).length; },
    async updateModeration(id, fields) { return patch(places.get(id), fields); },
    async applyModerationResultIf(id, revision, fields) {
      const p = places.get(id);
      if (!p || p.moderationRevision !== revision) return 0;
      patch(p, fields);
      return 1;
    },
    async statsByTours(ids) {
      return new Map(ids.map((id) => [id, { count: placesOf(id).length, humanCount: 0 }]));
    },
    async anchorsByTours(ids) {
      return new Map(ids.filter((id) => placesOf(id).length).map((id) => [id, { lat: placesOf(id)[0].lat, lng: placesOf(id)[0].lng }]));
    },
    // UC07 explore
    async countPublicPlaces() { return publicPlaces().length; },
    async searchPublicPlaces(_f, { skip, take }) {
      return publicPlaces().slice(skip, skip + take).map((p) => ({ ...p, tourTitle: tours.get(p.tourId).title, city: tours.get(p.tourId).city }));
    },
  };

  // Same semantics as PrismaTourAccessRepository: conditional status writes, grants deleted with a
  // passcode change, attempts counted after the insert. The hash never enters the entity.
  const accessRepo = {
    hashes: new Map(),
    grants: new Map(),
    attempts: [],
    async findAccess(tourId) {
      const t = tours.get(tourId);
      if (!t) return null;
      return { tourId, authorId: t.authorId, status: t.status, passcodeHash: this.hashes.get(tourId) ?? null, passcodeVersion: t.passcodeVersion, passcodeSetAt: t.passcodeSetAt };
    },
    dropGrants(tourId) { for (const k of [...this.grants.keys()]) if (k.startsWith(`${tourId}|`)) this.grants.delete(k); },
    async setPasscodeIf(tourId, fromStatuses, { passcodeHash, passcodeSetAt }) {
      const t = tours.get(tourId);
      if (!t || !fromStatuses.includes(t.status)) return null;
      patch(t, { status: TOUR_STATUS.RESTRICTED, passcodeSetAt, passcodeVersion: t.passcodeVersion + 1 });
      this.hashes.set(tourId, passcodeHash);
      this.dropGrants(tourId);
      return t;
    },
    async clearPasscodeIf(tourId) {
      const t = tours.get(tourId);
      if (!t || t.status !== TOUR_STATUS.RESTRICTED) return null;
      patch(t, { status: TOUR_STATUS.DRAFT, passcodeSetAt: null, passcodeVersion: t.passcodeVersion + 1 });
      this.hashes.delete(tourId);
      this.dropGrants(tourId);
      this.attempts = this.attempts.filter((a) => a.tourId !== tourId);
      return t;
    },
    async findGrant(tourId, userId) { return this.grants.get(`${tourId}|${userId}`) ?? null; },
    async saveGrant(tourId, userId, passcodeVersion) { this.grants.set(`${tourId}|${userId}`, { tourId, userId, passcodeVersion }); },
    async countGrants(tourId, version) { return [...this.grants.values()].filter((g) => g.tourId === tourId && g.passcodeVersion === version).length; },
    async reserveAttempt(tourId, userId, since) {
      const row = { id: crypto.randomUUID(), tourId, userId, createdAt: new Date(now) };
      this.attempts.push(row);
      return { id: row.id, count: this.attempts.filter((a) => a.tourId === tourId && a.userId === userId && a.createdAt >= since).length };
    },
    async releaseAttempt(id) { this.attempts = this.attempts.filter((a) => a.id !== id); },
  };

  const events = [];
  const publish = async (eventName, payload) => { events.push({ eventName, payload: validateEvent(eventName, payload) }); };
  const errors = [];
  const logger = { info() {}, warn() {}, error: (m) => errors.push(m) };
  const routeConfigRepo = { async findByTour() { return null; } };
  const mustNotWrite = { async createReport() { throw new Error('must not be called'); }, async upsert() { throw new Error('must not be called'); } };

  // container.js wiring with MODERATION_EVENTS_ENABLED and CHATBOT_EVENTS_ENABLED on.
  const deps = {
    tourRepo, placeRepo, accessRepo, routeConfigRepo, reviewActionRepo: { async listByTour() { return []; } },
    reportRepo: mustNotWrite, ratingRepo: mustNotWrite,
    zoneChecker: { async assertAllowed() {} },
    moderation: new EventModerationGateway({ publish, clock }),
    catalog: new EventTourCatalogPublisher({ publish, clock, logger }),
    reviewEvents: new EventTourReviewPublisher({ publish, clock }),
    hasher: new ScryptPasscodeHasher(),
    clock: () => new Date(now), // unlock window and passcodeSetAt read the time without moving it
    logger,
  };
  const uc = {
    createTour: new CreateTour(deps),
    addPlace: new AddPlace(deps),
    updateTour: new UpdateTour(deps),
    submit: new PublishTour(deps),
    approve: new ApproveTour(deps),
    reject: new RejectTour(deps),
    search: new SearchTours(deps),
    explore: new ExplorePlaces(deps),
    publicTour: new GetPublicTour(deps),
    publicPackage: new GetTourPackage(deps),
    report: new ReportTour(deps),
    rate: new SaveMyTourRating(deps),
    getAccess: new GetTourAccess(deps),
    setPasscode: new SetTourPasscode(deps),
    disable: new DisableTourAccess(deps),
    unlock: new UnlockTour(deps),
    mine: new GetMyTourAccess(deps),
    view: new GetRestrictedTour(deps),
    pack: new GetRestrictedTourPackage(deps),
  };
  const handler = buildModerationResultHandler({ applyModerationResult: new ApplyModerationResult(deps), validateEvent, logger });
  const deliver = async (eventName, payload) => {
    await handler(eventName, payload);
    assert.deepEqual(errors, [], `${eventName} must be applied without error`);
  };
  const names = () => events.map((e) => e.eventName);
  const last = (eventName) => events.filter((e) => e.eventName === eventName).at(-1)?.payload;
  return {
    uc, deliver, events, names, last, accessRepo,
    tourOf: (id) => tours.get(id),
    advance: (ms) => { now += ms; },
  };
}

/** UC09 / UC10 / UC15: a draft tour with two places that passed AI moderation (ready to submit). */
async function draftTour(w) {
  const tour = await w.uc.createTour.execute({ authorId: AUTHOR, title: 'Phố cổ Hội An', description: 'Đi bộ phố cổ',
    originalLanguage: 'vi', city: 'Hội An', duration: 90 });
  for (const name of ['Chùa Cầu', 'Hội quán Phúc Kiến']) {
    const p = await w.uc.addPlace.execute({ authorId: AUTHOR, tourId: tour.id, name, description: `Thuyết minh ${name}`, ...ME });
    await placePassed(w, p.id);
  }
  return tour.id;
}

/** Moderation answers the last place.submitted of a place (revision echoed back). */
async function placePassed(w, placeId) {
  const sent = w.events.filter((e) => e.eventName === EVENTS.PLACE_SUBMITTED && e.payload.placeId === placeId).at(-1).payload;
  await w.deliver(EVENTS.PLACE_AI_PASSED, { placeId, tourId: sent.tourId, revision: sent.revision });
}

/** UC14 step 4: the author turns restricted mode on (or changes the passcode, A1). */
const restrict = (w, tourId, passcode = CODE) => w.uc.setPasscode.execute({ authorId: AUTHOR, tourId, passcode });
const notFound = { status: 404 };

/** Every public read of UC02 / UC03 / UC07 (and UC05 / UC06 writes) for one tour. */
async function publicReads(w, tourId) {
  const ids = (cards) => cards.map((c) => c.id);
  return {
    search: ids((await w.uc.search.execute({ sort: 'popular', page: 1, limit: 20 })).tours).includes(tourId),
    searchQ: ids((await w.uc.search.execute({ q: 'hội an', sort: 'recent', page: 1, limit: 20 })).tours).includes(tourId),
    nearby: ids((await w.uc.search.execute({ sort: 'nearby', ...ME, page: 1, limit: 20 })).tours).includes(tourId),
    explore: (await w.uc.explore.execute({ ...ME })).items.some((i) => i.tourId === tourId),
  };
}

const CATALOG = [EVENTS.TOUR_PUBLISHED, EVENTS.TOUR_UNPUBLISHED];

// =========================================================
// 1. Author turns restricted mode on: the tour is never public
// =========================================================

test('UC14 1-4: draft with approved places -> restricted, version 1, no tour event, passcode never returned', async () => {
  const w = world();
  const tourId = await draftTour(w);
  const before = w.events.length;
  const res = await restrict(w, tourId);
  assert.equal(res.restricted, true);
  assert.equal(res.changed, 'enabled');
  assert.equal(res.testers, 0);
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.RESTRICTED);
  assert.equal(w.tourOf(tourId).passcodeVersion, 1);
  assert.equal(w.events.length, before, 'no tour.submitted / tour.published: no admin review for a restricted tour');
  const shown = JSON.stringify([res, await w.uc.getAccess.execute({ authorId: AUTHOR, tourId }), w.tourOf(tourId).toPublic()]);
  assert.ok(!shown.includes(CODE) && !shown.includes('scrypt'));
});

test('UC14 rule: a restricted tour is absent from search, nearby, explore, public detail and package; no rating or report', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  assert.deepEqual(await publicReads(w, tourId), { search: false, searchQ: false, nearby: false, explore: false });
  await assert.rejects(w.uc.publicTour.execute({ id: tourId, lang: 'vi' }), notFound);
  await assert.rejects(w.uc.publicPackage.execute({ id: tourId, lang: 'vi' }), notFound);
  await assert.rejects(w.uc.report.execute({ tourId, reporterId: TESTER, reason: 'spam' }), notFound);
  await assert.rejects(w.uc.rate.execute({ tourId, userId: TESTER, stars: 5 }), notFound);
  // even for an unlocked tester the public routes stay closed
  await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE });
  await assert.rejects(w.uc.publicTour.execute({ id: tourId }), notFound);
  assert.equal((await publicReads(w, tourId)).search, false);
});

test('UC14 A3 + E6: edits and place results keep it restricted, never send tour.published; submit -> 409 tour_restricted', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  const from = w.events.length;
  const edit = await w.uc.updateTour.execute({ authorId: AUTHOR, tourId, patch: { title: 'Phố cổ Hội An (bản thử)' } });
  assert.equal(edit.tour.status, TOUR_STATUS.RESTRICTED);
  const p = await w.uc.addPlace.execute({ authorId: AUTHOR, tourId, name: 'Nhà cổ Tấn Ký', description: 'Nhà cổ', ...ME });
  await placePassed(w, p.id); // place moderation still runs (A3)
  await assert.rejects(w.uc.submit.execute({ authorId: AUTHOR, tourId }), { status: 409, code: 'tour_restricted' });
  assert.deepEqual(w.events.slice(from).map((e) => e.eventName), [EVENTS.PLACE_SUBMITTED]);
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.RESTRICTED);
  // testers see the new content
  const v = await w.uc.view.execute({ tourId, userId: AUTHOR, lang: 'vi' });
  assert.equal(v.title, 'Phố cổ Hội An (bản thử)');
  assert.equal(v.placeCount, 3);
});

// =========================================================
// 2. Testers: locked out, wrong code, rate limit, unlock
// =========================================================

test('UC14 E5: a signed-in account that did not unlock gets { unlocked:false } and 404 on detail and package', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  assert.deepEqual(await w.uc.mine.execute({ tourId, userId: TESTER }), { unlocked: false });
  await assert.rejects(w.uc.view.execute({ tourId, userId: TESTER }), notFound);
  await assert.rejects(w.uc.pack.execute({ tourId, userId: TESTER, lang: 'vi' }), notFound);
  // the author needs no passcode (A2: owner always has access)
  assert.deepEqual(await w.uc.mine.execute({ tourId, userId: AUTHOR }), { unlocked: true });
  assert.equal((await w.uc.pack.execute({ tourId, userId: AUTHOR, lang: 'vi' })).restricted, true);
});

test('UC14 E3 + E4: wrong code 403, five failures in 15 minutes -> 429 even with the right code, then the window ends', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  await assert.rejects(w.uc.unlock.execute({ tourId, userId: TESTER, passcode: 'sai-ma-1' }),
    { status: 403, code: 'wrong_passcode', message: 'Mã truy cập không đúng' });
  for (let i = 2; i <= UNLOCK_MAX_FAILURES; i += 1) {
    await assert.rejects(w.uc.unlock.execute({ tourId, userId: TESTER, passcode: `sai-ma-${i}` }), { status: 403 });
  }
  await assert.rejects(w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE }), { status: 429, code: 'too_many_attempts' });
  await assert.rejects(w.uc.view.execute({ tourId, userId: TESTER }), notFound);
  // the limit is per account: another tester is not blocked
  assert.deepEqual(await w.uc.unlock.execute({ tourId, userId: 'tester-2', passcode: CODE }), { unlocked: true });
  w.advance(UNLOCK_WINDOW_MS + 1000);
  assert.deepEqual(await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE }), { unlocked: true });
});

test('UC14 8-11 + A5: right code unlocks; detail and offline package for that account only; A2 no new prompt', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  assert.deepEqual(await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: ` ${CODE} ` }), { unlocked: true });
  assert.equal((await w.uc.getAccess.execute({ authorId: AUTHOR, tourId })).testers, 1);

  const v = await w.uc.view.execute({ tourId, userId: TESTER, lang: 'vi' });
  assert.equal(v.id, tourId);
  assert.equal(v.restricted, true);
  assert.deepEqual(v.places.map((p) => p.name), ['Chùa Cầu', 'Hội quán Phúc Kiến']);
  const pkg = await w.uc.pack.execute({ tourId, userId: TESTER, lang: 'vi' });
  assert.equal(pkg.tourId, tourId);
  assert.equal(pkg.language, 'vi');
  assert.equal(pkg.restricted, true);
  assert.equal(pkg.detail.places.length, 2);
  assert.ok(pkg.revision);
  assert.ok(!JSON.stringify([v, pkg]).includes('scrypt'));

  // another account has nothing
  await assert.rejects(w.uc.view.execute({ tourId, userId: 'tester-2' }), notFound);
  await assert.rejects(w.uc.pack.execute({ tourId, userId: 'tester-2' }), notFound);
  // A2: back later, still unlocked, and checking does not count an attempt
  const attempts = w.accessRepo.attempts.length;
  assert.deepEqual(await w.uc.mine.execute({ tourId, userId: TESTER }), { unlocked: true });
  assert.equal(w.accessRepo.attempts.length, attempts);
});

// =========================================================
// 3. Author changes the passcode, turns the mode off
// =========================================================

test('UC14 A1.2: a new passcode drops every unlock: detail and package 404, old code 403, new code works', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE });
  const changed = await restrict(w, tourId, NEW_CODE);
  assert.equal(changed.changed, 'passcode');
  assert.equal(changed.testers, 0);
  assert.equal(w.tourOf(tourId).passcodeVersion, 2);
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.RESTRICTED);

  assert.deepEqual(await w.uc.mine.execute({ tourId, userId: TESTER }), { unlocked: false });
  await assert.rejects(w.uc.view.execute({ tourId, userId: TESTER }), notFound);
  await assert.rejects(w.uc.pack.execute({ tourId, userId: TESTER, lang: 'vi' }), notFound); // A5: stored copy cannot update
  await assert.rejects(w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE }), { status: 403 });
  assert.deepEqual(await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: NEW_CODE }), { unlocked: true });
  assert.equal((await w.uc.view.execute({ tourId, userId: TESTER })).id, tourId);
});

test('UC14 A1.4: turning the mode off -> draft, testers lose access, nothing published, second off 409', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE });
  const from = w.events.length;
  const { tour } = await w.uc.disable.execute({ authorId: AUTHOR, tourId });
  assert.equal(tour.status, TOUR_STATUS.DRAFT);
  assert.deepEqual(await w.uc.getAccess.execute({ authorId: AUTHOR, tourId }), { restricted: false, passcodeSetAt: null, testers: 0 });
  for (const call of [
    w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE }),
    w.uc.mine.execute({ tourId, userId: TESTER }),
    w.uc.view.execute({ tourId, userId: TESTER }),
    w.uc.pack.execute({ tourId, userId: TESTER }),
  ]) await assert.rejects(call, notFound);
  await assert.rejects(w.uc.disable.execute({ authorId: AUTHOR, tourId }), { status: 409, code: 'tour_not_restricted' });
  assert.equal(w.events.length, from);
  // still a draft: not public either
  assert.equal((await publicReads(w, tourId)).search, false);
  // on again with the same code: the old unlock does not come back
  await restrict(w, tourId);
  assert.deepEqual(await w.uc.mine.execute({ tourId, userId: TESTER }), { unlocked: false });
});

// =========================================================
// 4. Public again (A4 = off -> UC15 submit -> UC19 approve)
// =========================================================

test('UC14 A4 -> UC15 -> UC19: off, submit, AI pass, approve -> public, tour.published sent, visible everywhere', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await restrict(w, tourId);
  await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE });
  await w.uc.disable.execute({ authorId: AUTHOR, tourId });

  const sub = await w.uc.submit.execute({ authorId: AUTHOR, tourId });
  assert.equal(sub.tour.status, TOUR_STATUS.AI_CHECKING);
  // E2: in moderation it cannot be restricted again
  await assert.rejects(restrict(w, tourId), { status: 409, code: 'tour_not_restrictable' });
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: w.last(EVENTS.TOUR_SUBMITTED).revision });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PENDING_REVIEW);
  await w.uc.approve.execute({ tourId, adminId: 'adm1' });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.PUBLIC);

  const published = w.events.filter((e) => e.eventName === EVENTS.TOUR_PUBLISHED);
  assert.equal(published.length, 1, 'tour.published only once, at approval');
  assert.equal(published[0].payload.tourId, tourId);
  assert.equal(published[0].payload.places.length, 2);
  assert.deepEqual(await publicReads(w, tourId), { search: true, searchQ: true, nearby: true, explore: true });
  assert.equal((await w.uc.publicTour.execute({ id: tourId, lang: 'vi' })).id, tourId);
  const pkg = await w.uc.publicPackage.execute({ id: tourId, lang: 'vi' });
  assert.equal(pkg.tourId, tourId);
  assert.equal(pkg.restricted, undefined);
  // restricted routes are closed for the public tour; a public tour cannot be restricted
  await assert.rejects(w.uc.view.execute({ tourId, userId: TESTER }), notFound);
  await assert.rejects(restrict(w, tourId), { status: 409, code: 'tour_not_restrictable' });
});

test('UC19 reject -> UC14: a rejected tour can be tested with a passcode, then resubmitted after turning it off', async () => {
  const w = world();
  const tourId = await draftTour(w);
  await w.uc.submit.execute({ authorId: AUTHOR, tourId });
  await w.deliver(EVENTS.TOUR_AI_PASSED, { tourId, revision: w.last(EVENTS.TOUR_SUBMITTED).revision });
  await w.uc.reject.execute({ tourId, adminId: 'adm1', reason: 'Thiếu thông tin lịch sử' });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.REJECTED);

  assert.equal((await restrict(w, tourId)).changed, 'enabled');
  await w.uc.unlock.execute({ tourId, userId: TESTER, passcode: CODE });
  assert.equal((await w.uc.view.execute({ tourId, userId: TESTER })).restricted, true);
  await assert.rejects(w.uc.submit.execute({ authorId: AUTHOR, tourId }), { status: 409, code: 'tour_restricted' });
  await w.uc.disable.execute({ authorId: AUTHOR, tourId });
  assert.equal(w.tourOf(tourId).status, TOUR_STATUS.DRAFT); // off -> draft, not back to rejected
  assert.equal((await w.uc.submit.execute({ authorId: AUTHOR, tourId })).tour.status, TOUR_STATUS.AI_CHECKING);
  assert.ok(!w.names().some((n) => CATALOG.includes(n)), 'never public: no catalog event');
});

// =========================================================
// 5. The same journey over HTTP (router + controller, verifyJwt stand-ins)
// =========================================================

async function startApp(w) {
  const controller = new TourAccessController({
    getTourAccess: w.uc.getAccess, setTourPasscode: w.uc.setPasscode, disableTourAccess: w.uc.disable,
    unlockTour: w.uc.unlock, getMyTourAccess: w.uc.mine, getRestrictedTour: w.uc.view, getRestrictedTourPackage: w.uc.pack,
  });
  // Stand-ins for verifyJwt() / verifyJwt(['contributor']): x-user = "<sub>:<role>".
  const guard = (role) => (req, res, next) => {
    const [sub, r] = String(req.headers['x-user'] ?? '').split(':');
    if (!sub) return res.status(401).json({ error: 'Unauthorized' });
    if (role && r !== role) return res.status(403).json({ error: 'Forbidden' });
    req.user = { sub, role: r };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildTourAccessRouter({ tourAccessController: controller, requireAuth: guard(), requireContributor: guard('contributor') }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body } = {}) => {
    const headers = { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) };
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('HTTP journey: restrict, anonymous 401, tester 404 -> 403 -> unlock -> detail + package, new passcode -> 404, off', async () => {
  const w = world();
  const tourId = await draftTour(w);
  const { call, close } = await startApp(w);
  const owner = `${AUTHOR}:contributor`;
  const tester = `${TESTER}:tourist`;
  try {
    assert.equal((await call('PUT', `/mine/${tourId}/access`, { user: tester, body: { passcode: CODE } })).status, 403);
    const on = await call('PUT', `/mine/${tourId}/access`, { user: owner, body: { passcode: CODE } });
    assert.equal(on.status, 200);
    assert.equal(on.body.changed, 'enabled');

    for (const [m, p] of [['POST', 'unlock'], ['GET', 'access/mine'], ['GET', 'restricted'], ['GET', 'restricted/package']]) {
      assert.equal((await call(m, `/${tourId}/${p}`, { body: m === 'POST' ? { passcode: CODE } : undefined })).status, 401, `anonymous ${p}`);
    }
    assert.equal((await call('GET', `/${tourId}/restricted?lang=vi`, { user: tester })).status, 404);
    assert.equal((await call('GET', `/${tourId}/restricted/package?lang=vi`, { user: tester })).status, 404);
    assert.deepEqual(await call('POST', `/${tourId}/unlock`, { user: tester, body: { passcode: 'sai-ma-x' } }),
      { status: 403, body: { error: 'Mã truy cập không đúng', code: 'wrong_passcode' } });
    assert.deepEqual(await call('POST', `/${tourId}/unlock`, { user: tester, body: { passcode: CODE } }), { status: 200, body: { unlocked: true } });

    const detail = await call('GET', `/${tourId}/restricted?lang=vi`, { user: tester });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.tour.id, tourId);
    const pkg = await call('GET', `/${tourId}/restricted/package?lang=vi`, { user: tester });
    assert.equal(pkg.status, 200);
    assert.equal(pkg.body.restricted, true);
    assert.equal((await call('GET', `/${tourId}/restricted/package`, { user: 'other:tourist' })).status, 404);

    assert.equal((await call('PUT', `/mine/${tourId}/access`, { user: owner, body: { passcode: NEW_CODE } })).body.changed, 'passcode');
    assert.deepEqual((await call('GET', `/${tourId}/access/mine`, { user: tester })).body, { unlocked: false });
    assert.equal((await call('GET', `/${tourId}/restricted/package?lang=vi`, { user: tester })).status, 404);

    const off = await call('DELETE', `/mine/${tourId}/access`, { user: owner });
    assert.equal(off.body.tour.status, TOUR_STATUS.DRAFT);
    assert.equal((await call('POST', `/${tourId}/unlock`, { user: tester, body: { passcode: NEW_CODE } })).status, 404);
    assert.ok(!w.names().some((n) => CATALOG.includes(n)));
  } finally {
    await close();
  }
});
