// =========================================================
// UC14 (#269) — restricted access with a passcode: domain rules, scrypt hasher, use cases with
// in-memory fakes (same semantics as PrismaTourAccessRepository), the guards against moderation /
// catalog / public search, and the HTTP routes with stand-ins for verifyJwt.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

import { Tour, TOUR_STATUS } from '../src/domain/entities/tour.js';
import {
  normalizePasscode,
  isGrantValid,
  UNLOCK_MAX_FAILURES,
  UNLOCK_WINDOW_MS,
} from '../src/domain/tour/restricted-access.js';
import { ScryptPasscodeHasher } from '../src/infrastructure/security/scrypt-passcode-hasher.js';
import {
  GetTourAccess,
  SetTourPasscode,
  DisableTourAccess,
  UnlockTour,
  GetMyTourAccess,
  GetRestrictedTour,
  GetRestrictedTourPackage,
} from '../src/application/use-cases/tour-access.js';
import { PublishTour, GetPublishReadiness } from '../src/application/use-cases/publish-tour.js';
import { UpdateTour } from '../src/application/use-cases/update-tour.js';
import { notifyTourPublished } from '../src/application/use-cases/notify-tour-catalog.js';
import { PrismaTourRepository } from '../src/infrastructure/persistence/prisma-tour-repository.js';
import { PrismaPlaceRepository } from '../src/infrastructure/persistence/prisma-place-repository.js';
import { TourAccessController } from '../src/interfaces/http/controllers/tour-access-controller.js';
import { buildTourAccessRouter } from '../src/interfaces/http/routes/tour-access-routes.js';

const T_DRAFT = '11111111-1111-4111-8111-111111111111';
const T_PUBLIC = '22222222-2222-4222-8222-222222222222';
const T_REJECTED = '33333333-3333-4333-8333-333333333333';
const T_CHANGES = '44444444-4444-4444-8444-444444444444';
const T_CHECKING = '55555555-5555-4555-8555-555555555555';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const AUTHOR = 'author-1';
const CODE = 'Test2026';

const makeTour = (id, status) =>
  new Tour({ id, title: `Tour ${id.slice(0, 4)}`, description: 'Mô tả', originalLanguage: 'vi', authorId: AUTHOR, status, updatedAt: new Date('2026-11-01T00:00:00Z') });

// Same semantics as PrismaTourRepository (findById / save) on the shared rows.
class FakeTourRepo {
  constructor(tours) {
    this.rows = new Map(tours.map((t) => [t.id, t]));
    this.saves = 0;
  }
  async findById(id) {
    return this.rows.get(id) ?? null;
  }
  async save(tour) {
    this.saves += 1;
    tour.updatedAt = new Date();
    this.rows.set(tour.id, tour);
    return tour;
  }
  async findPublicById(id) {
    const t = this.rows.get(id);
    return t?.isPublic() ? t : null;
  }
  async updateModeration() {
    throw new Error('updateModeration must not be called');
  }
}

// Same semantics as PrismaTourAccessRepository: conditional status writes, grants deleted with a
// passcode change, attempts counted after the insert. The hash lives outside the entity.
class FakeAccessRepo {
  constructor(tourRepo, clock) {
    this.tourRepo = tourRepo;
    this.clock = clock;
    this.hashes = new Map();
    this.grants = new Map();
    this.attempts = [];
  }
  async findAccess(tourId) {
    const t = this.tourRepo.rows.get(tourId);
    if (!t) return null;
    return { tourId, authorId: t.authorId, status: t.status, passcodeHash: this.hashes.get(tourId) ?? null, passcodeVersion: t.passcodeVersion, passcodeSetAt: t.passcodeSetAt };
  }
  async setPasscodeIf(tourId, fromStatuses, { passcodeHash, passcodeSetAt }) {
    const t = this.tourRepo.rows.get(tourId);
    if (!t || !fromStatuses.includes(t.status)) return null;
    Object.assign(t, { status: TOUR_STATUS.RESTRICTED, passcodeSetAt, passcodeVersion: t.passcodeVersion + 1, updatedAt: new Date() });
    this.hashes.set(tourId, passcodeHash);
    for (const k of [...this.grants.keys()]) if (k.startsWith(`${tourId}|`)) this.grants.delete(k);
    return t;
  }
  async clearPasscodeIf(tourId) {
    const t = this.tourRepo.rows.get(tourId);
    if (!t || t.status !== TOUR_STATUS.RESTRICTED) return null;
    Object.assign(t, { status: TOUR_STATUS.DRAFT, passcodeSetAt: null, passcodeVersion: t.passcodeVersion + 1, updatedAt: new Date() });
    this.hashes.delete(tourId);
    for (const k of [...this.grants.keys()]) if (k.startsWith(`${tourId}|`)) this.grants.delete(k);
    this.attempts = this.attempts.filter((a) => a.tourId !== tourId);
    return t;
  }
  async findGrant(tourId, userId) {
    return this.grants.get(`${tourId}|${userId}`) ?? null;
  }
  async saveGrant(tourId, userId, passcodeVersion) {
    this.grants.set(`${tourId}|${userId}`, { tourId, userId, passcodeVersion, createdAt: this.clock() });
  }
  async countGrants(tourId, passcodeVersion) {
    return [...this.grants.values()].filter((g) => g.tourId === tourId && g.passcodeVersion === passcodeVersion).length;
  }
  async reserveAttempt(tourId, userId, since) {
    const row = { id: crypto.randomUUID(), tourId, userId, createdAt: this.clock() };
    this.attempts.push(row);
    const count = this.attempts.filter((a) => a.tourId === tourId && a.userId === userId && a.createdAt >= since).length;
    return { id: row.id, count };
  }
  async releaseAttempt(id) {
    this.attempts = this.attempts.filter((a) => a.id !== id);
  }
}

const places = {
  [T_DRAFT]: [
    { id: 'p1', tourId: T_DRAFT, name: 'Chùa Cầu', type: 'historical', description: 'Cầu cổ', lat: 15.8, lng: 108.3, sequence: 0, images: [], audioSource: 'tts', moderationStatus: 'approved' },
  ],
};

function kit() {
  let now = new Date('2026-11-04T08:00:00Z');
  const clock = () => now;
  const tourRepo = new FakeTourRepo([
    makeTour(T_DRAFT, TOUR_STATUS.DRAFT),
    makeTour(T_PUBLIC, TOUR_STATUS.PUBLIC),
    makeTour(T_REJECTED, TOUR_STATUS.REJECTED),
    makeTour(T_CHANGES, TOUR_STATUS.CHANGES_REQUESTED),
    makeTour(T_CHECKING, TOUR_STATUS.AI_CHECKING),
  ]);
  const accessRepo = new FakeAccessRepo(tourRepo, clock);
  const hasher = new ScryptPasscodeHasher();
  const placeRepo = { async listByTour(id) { return places[id] ?? []; } };
  const routeConfigRepo = { async findByTour() { return null; } };
  return {
    tourRepo,
    accessRepo,
    placeRepo,
    advance: (ms) => { now = new Date(now.getTime() + ms); },
    get: new GetTourAccess({ tourRepo, accessRepo }),
    set: new SetTourPasscode({ tourRepo, accessRepo, hasher, clock }),
    disable: new DisableTourAccess({ tourRepo, accessRepo }),
    unlock: new UnlockTour({ accessRepo, hasher, clock }),
    mine: new GetMyTourAccess({ accessRepo }),
    view: new GetRestrictedTour({ tourRepo, accessRepo, placeRepo, routeConfigRepo }),
    pack: new GetRestrictedTourPackage({ tourRepo, accessRepo, placeRepo, routeConfigRepo }),
  };
}

const restrict = (k, tourId = T_DRAFT, passcode = CODE) => k.set.execute({ authorId: AUTHOR, tourId, passcode });

// ---------- domain ----------
test('E1 passcode rules: trimmed, 6..32 characters, no whitespace inside, Vietnamese messages', () => {
  assert.equal(normalizePasscode('  abc123  '), 'abc123');
  assert.equal(normalizePasscode('x'.repeat(32)), 'x'.repeat(32));
  for (const bad of [undefined, null, '', '   ', 12345678]) {
    assert.throws(() => normalizePasscode(bad), { status: 400, code: 'validation_error', message: 'Vui lòng nhập mã truy cập' });
  }
  assert.throws(() => normalizePasscode('abc12'), { status: 400, message: 'Mã truy cập phải từ 6 đến 32 ký tự' });
  assert.throws(() => normalizePasscode('x'.repeat(33)), { status: 400 });
  assert.throws(() => normalizePasscode('abc 1234'), { status: 400, message: 'Mã truy cập không được chứa khoảng trắng' });
});

test('status rules: restrictable from draft / rejected / changes_requested only; restricted is not live nor publishable', () => {
  const ok = [TOUR_STATUS.DRAFT, TOUR_STATUS.REJECTED, TOUR_STATUS.CHANGES_REQUESTED];
  for (const s of Object.values(TOUR_STATUS)) assert.equal(makeTour(T_DRAFT, s).canRestrict(), ok.includes(s), s);
  const r = makeTour(T_DRAFT, TOUR_STATUS.RESTRICTED);
  assert.equal(r.isRestricted(), true);
  assert.equal(r.isLive(), false);
  assert.equal(r.isPublic(), false);
  assert.equal(r.canPublish(), false);
  assert.equal(r.applyEdits({ title: 'Mới' }), false);
  assert.equal(r.status, TOUR_STATUS.RESTRICTED);
  assert.equal(isGrantValid({ passcodeVersion: 2 }, 2), true);
  assert.equal(isGrantValid({ passcodeVersion: 1 }, 2), false);
  assert.equal(isGrantValid(null, 2), false);
});

test('scrypt hasher: random salt, verify right / wrong, malformed stored value is false', async () => {
  const h = new ScryptPasscodeHasher();
  const a = await h.hash(CODE);
  const b = await h.hash(CODE);
  assert.match(a, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes(CODE));
  assert.equal(await h.verify(CODE, a), true);
  assert.equal(await h.verify('test2026', a), false);
  for (const bad of [null, '', 'plain', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5']) assert.equal(await h.verify(CODE, bad), false);
});

// ---------- author: on / change / off ----------
test('turn on from draft: restricted, no hash in the answer, version 1, testers 0', async () => {
  const k = kit();
  const res = await restrict(k);
  assert.deepEqual(res, { restricted: true, passcodeSetAt: new Date('2026-11-04T08:00:00Z'), testers: 0, changed: 'enabled' });
  const t = k.tourRepo.rows.get(T_DRAFT);
  assert.equal(t.status, TOUR_STATUS.RESTRICTED);
  assert.equal(t.passcodeVersion, 1);
  assert.ok(k.accessRepo.hashes.get(T_DRAFT).startsWith('scrypt$'));
  const json = JSON.stringify([res, t.toPublic(), t.toSummary(), await k.get.execute({ authorId: AUTHOR, tourId: T_DRAFT })]);
  assert.ok(!json.includes('scrypt') && !json.includes(CODE) && !json.includes('passcodeHash'));
});

test('turn on from rejected and changes_requested works; public and in-moderation tours answer 409', async () => {
  const k = kit();
  assert.equal((await restrict(k, T_REJECTED)).restricted, true);
  assert.equal((await restrict(k, T_CHANGES)).restricted, true);
  for (const id of [T_PUBLIC, T_CHECKING]) {
    await assert.rejects(restrict(k, id), { status: 409, code: 'tour_not_restrictable' });
    assert.notEqual(k.tourRepo.rows.get(id).status, TOUR_STATUS.RESTRICTED);
  }
});

test('E1 invalid passcode -> 400 and the tour stays draft', async () => {
  const k = kit();
  await assert.rejects(restrict(k, T_DRAFT, '123'), { status: 400, code: 'validation_error' });
  assert.equal(k.tourRepo.rows.get(T_DRAFT).status, TOUR_STATUS.DRAFT);
});

test('owner only: another account gets 403 on get / set / off; unknown tour 404', async () => {
  const k = kit();
  await restrict(k);
  const other = { authorId: 'someone', tourId: T_DRAFT };
  await assert.rejects(k.get.execute(other), { status: 403, code: 'not_tour_owner' });
  await assert.rejects(k.set.execute({ ...other, passcode: 'Other123' }), { status: 403 });
  await assert.rejects(k.disable.execute(other), { status: 403 });
  await assert.rejects(k.get.execute({ authorId: AUTHOR, tourId: UNKNOWN }), { status: 404 });
});

test('A1 change passcode: new hash, version + 1, every older unlock invalidated', async () => {
  const k = kit();
  await restrict(k);
  const oldHash = k.accessRepo.hashes.get(T_DRAFT);
  assert.deepEqual(await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE }), { unlocked: true });
  assert.equal((await k.get.execute({ authorId: AUTHOR, tourId: T_DRAFT })).testers, 1);

  k.advance(1000);
  const res = await restrict(k, T_DRAFT, 'NewCode99');
  assert.equal(res.changed, 'passcode');
  assert.equal(res.testers, 0);
  assert.notEqual(k.accessRepo.hashes.get(T_DRAFT), oldHash);
  assert.equal(k.tourRepo.rows.get(T_DRAFT).passcodeVersion, 2);
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'tester' }), { unlocked: false });
  await assert.rejects(k.view.execute({ tourId: T_DRAFT, userId: 'tester' }), { status: 404 });
  await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE }), { status: 403 });
  assert.deepEqual(await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: 'NewCode99' }), { unlocked: true });
});

test('a grant left with an old version (race with a passcode change) never opens the tour', async () => {
  const k = kit();
  await restrict(k);
  await k.accessRepo.saveGrant(T_DRAFT, 'late', 0);
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'late' }), { unlocked: false });
});

test('A1 turn off: back to draft, hash and unlocks cleared; second off 409; testers get 404', async () => {
  const k = kit();
  await restrict(k);
  await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE });
  const { tour } = await k.disable.execute({ authorId: AUTHOR, tourId: T_DRAFT });
  assert.equal(tour.status, TOUR_STATUS.DRAFT);
  assert.equal(k.accessRepo.hashes.has(T_DRAFT), false);
  assert.equal(k.accessRepo.grants.size, 0);
  assert.deepEqual(await k.get.execute({ authorId: AUTHOR, tourId: T_DRAFT }), { restricted: false, passcodeSetAt: null, testers: 0 });
  await assert.rejects(k.disable.execute({ authorId: AUTHOR, tourId: T_DRAFT }), { status: 409, code: 'tour_not_restricted' });
  await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE }), { status: 404 });
  await assert.rejects(k.view.execute({ tourId: T_DRAFT, userId: 'tester' }), { status: 404 });
  // On again: the old unlock does not come back.
  await restrict(k);
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'tester' }), { unlocked: false });
});

test('the status moved between the read and the conditional write -> 409', async () => {
  const k = kit();
  const real = k.accessRepo.setPasscodeIf.bind(k.accessRepo);
  k.accessRepo.setPasscodeIf = async (...args) => {
    k.tourRepo.rows.get(T_DRAFT).status = TOUR_STATUS.PUBLIC; // published meanwhile
    return real(...args);
  };
  await assert.rejects(restrict(k), { status: 409, code: 'tour_not_restrictable' });
  assert.equal(k.tourRepo.rows.get(T_DRAFT).status, TOUR_STATUS.PUBLIC);
});

// ---------- tester: unlock, view, rate limit ----------
test('unlock: wrong code 403 "Mã truy cập không đúng"; right code (trimmed) 200 and kept per account', async () => {
  const k = kit();
  await restrict(k);
  await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: 'wrong-code' }), {
    status: 403,
    code: 'wrong_passcode',
    message: 'Mã truy cập không đúng',
  });
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'tester' }), { unlocked: false });
  assert.deepEqual(await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: ` ${CODE} ` }), { unlocked: true });
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'tester' }), { unlocked: true });
  assert.deepEqual(await k.mine.execute({ tourId: T_DRAFT, userId: 'other' }), { unlocked: false });
  // a right code is not a failure: only the wrong one is still counted
  assert.equal(k.accessRepo.attempts.length, 1);
});

test('unlock / mine / view of a tour that is not restricted, or unknown -> 404', async () => {
  const k = kit();
  for (const id of [T_DRAFT, T_PUBLIC, UNKNOWN]) {
    await assert.rejects(k.unlock.execute({ tourId: id, userId: 'tester', passcode: CODE }), { status: 404 });
    await assert.rejects(k.mine.execute({ tourId: id, userId: 'tester' }), { status: 404 });
    await assert.rejects(k.view.execute({ tourId: id, userId: 'tester' }), { status: 404 });
  }
});

test('rate limit: 5 wrong attempts per account and tour in 15 minutes, then 429 even with the right code', async () => {
  const k = kit();
  await restrict(k);
  for (let i = 0; i < UNLOCK_MAX_FAILURES; i += 1) {
    await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: `wrong-${i}` }), { status: 403 });
  }
  await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE }), {
    status: 429,
    code: 'too_many_attempts',
  });
  // another account and the owner are not blocked
  assert.deepEqual(await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester-2', passcode: CODE }), { unlocked: true });
  // refused requests do not extend the lock: after the window the account can try again
  k.advance(UNLOCK_WINDOW_MS + 1000);
  assert.deepEqual(await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE }), { unlocked: true });
});

test('rate limit holds for concurrent wrong attempts: 10 at once -> 5 checked (403), 5 refused (429)', async () => {
  const k = kit();
  await restrict(k);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => k.unlock.execute({ tourId: T_DRAFT, userId: 'bot', passcode: `guess-${i}` })),
  );
  const codes = results.map((r) => r.reason?.status).sort();
  assert.deepEqual(codes, [403, 403, 403, 403, 403, 429, 429, 429, 429, 429]);
});

test('view: unlocked tester and owner read the same detail view as the public one; others 404', async () => {
  const k = kit();
  await restrict(k);
  await assert.rejects(k.view.execute({ tourId: T_DRAFT, userId: 'stranger' }), { status: 404 });
  await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE });
  const v = await k.view.execute({ tourId: T_DRAFT, userId: 'tester', lang: 'vi' });
  assert.equal(v.id, T_DRAFT);
  assert.equal(v.restricted, true);
  assert.equal(v.placeCount, 1);
  assert.equal(v.places[0].text, 'Cầu cổ');
  assert.ok(v.route);
  assert.ok(!JSON.stringify(v).includes('scrypt'));
  const owner = await k.view.execute({ tourId: T_DRAFT, userId: AUTHOR });
  assert.equal(owner.id, T_DRAFT);
});

test('unlock bookkeeping never touches the tour (updated_at / saves)', async () => {
  const k = kit();
  await restrict(k);
  const t = k.tourRepo.rows.get(T_DRAFT);
  const before = t.updatedAt;
  await assert.rejects(k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: 'nope-nope' }));
  await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE });
  await k.mine.execute({ tourId: T_DRAFT, userId: 'tester' });
  assert.equal(t.updatedAt, before);
  assert.equal(k.tourRepo.saves, 0);
});

// ---------- never public: moderation, catalog, search ----------
test('L9 package: unlocked tester and owner get the offline package; others, old unlocks and non-restricted tours 404', async () => {
  const k = kit();
  await assert.rejects(k.pack.execute({ tourId: T_DRAFT, userId: AUTHOR }), { status: 404 }); // not restricted yet
  await restrict(k);
  await assert.rejects(k.pack.execute({ tourId: T_DRAFT, userId: 'stranger' }), { status: 404 });
  await k.unlock.execute({ tourId: T_DRAFT, userId: 'tester', passcode: CODE });
  const p = await k.pack.execute({ tourId: T_DRAFT, userId: 'tester', lang: 'vi' });
  assert.equal(p.tourId, T_DRAFT);
  assert.equal(p.language, 'vi');
  assert.equal(p.restricted, true);
  assert.equal(p.detail.id, T_DRAFT);
  assert.equal(p.detail.places[0].text, 'Cầu cổ');
  assert.ok(Array.isArray(p.assets));
  assert.ok(!JSON.stringify(p).includes('scrypt'));
  assert.equal((await k.pack.execute({ tourId: T_DRAFT, userId: AUTHOR })).tourId, T_DRAFT);
  // A new passcode invalidates the old unlock for the package too.
  await restrict(k, T_DRAFT, 'another-code-9');
  await assert.rejects(k.pack.execute({ tourId: T_DRAFT, userId: 'tester' }), { status: 404 });
});

test('a restricted tour cannot be published / submitted for review: 409 tour_restricted, nothing sent', async () => {
  const k = kit();
  await restrict(k);
  const sent = [];
  const moderation = { submitTour: async () => sent.push('tour.submitted'), submitPlace: async () => sent.push('place.submitted') };
  const catalog = { publishTourPublished: async () => sent.push('tour.published'), publishTourUnpublished: async () => sent.push('tour.unpublished') };
  for (const deps of [{}, { moderation }, { catalog }]) {
    const uc = new PublishTour({ tourRepo: k.tourRepo, placeRepo: k.placeRepo, ...deps });
    await assert.rejects(uc.execute({ authorId: AUTHOR, tourId: T_DRAFT }), { status: 409, code: 'tour_restricted' });
  }
  const readiness = await new GetPublishReadiness({ tourRepo: k.tourRepo, placeRepo: k.placeRepo }).execute({ authorId: AUTHOR, tourId: T_DRAFT });
  assert.equal(readiness.canPublish, false);
  assert.deepEqual(sent, []);
  assert.equal(k.tourRepo.rows.get(T_DRAFT).status, TOUR_STATUS.RESTRICTED);
});

test('editing a restricted tour keeps it restricted; no moderation withdraw, no catalog event', async () => {
  const k = kit();
  await restrict(k);
  const sent = [];
  const moderation = { submitTour: async () => sent.push('tour.submitted') };
  const catalog = { publishTourPublished: async () => sent.push('tour.published'), publishTourUnpublished: async () => sent.push('tour.unpublished') };
  const uc = new UpdateTour({ tourRepo: k.tourRepo, moderation, catalog, logger: { info() {}, error() {} } });
  const res = await uc.execute({ authorId: AUTHOR, tourId: T_DRAFT, patch: { title: 'Tên mới', description: 'Mô tả mới' } });
  assert.equal(res.tour.status, TOUR_STATUS.RESTRICTED);
  assert.equal(res.requiresResubmit, false);
  assert.deepEqual(sent, []);
});

test('catalog: tour.published is never sent for a restricted tour (D25 public only)', async () => {
  const sent = [];
  const catalog = { publishTourPublished: async (t) => sent.push(t.id) };
  const placeRepo = { async listByTour() { return []; } };
  await notifyTourPublished({ catalog, placeRepo }, makeTour(T_DRAFT, TOUR_STATUS.RESTRICTED));
  assert.deepEqual(sent, []);
  await notifyTourPublished({ catalog, placeRepo }, makeTour(T_PUBLIC, TOUR_STATUS.PUBLIC));
  assert.deepEqual(sent, [T_PUBLIC]);
});

test('public search, explore and public detail filter on status public only', async () => {
  assert.equal(PrismaTourRepository.publicWhere({}).status, 'public');
  assert.equal(PrismaTourRepository.publicWhere({ q: 'x', city: 'Huế', authorId: AUTHOR }).status, 'public');
  assert.deepEqual(PrismaPlaceRepository.publicPlaceWhere({}).tour, { is: { status: 'public' } });
  const k = kit();
  await restrict(k);
  assert.equal(await k.tourRepo.findPublicById(T_DRAFT), null);
});

// ---------- HTTP ----------
async function startApp() {
  const k = kit();
  const controller = new TourAccessController({
    getTourAccess: k.get,
    setTourPasscode: k.set,
    disableTourAccess: k.disable,
    unlockTour: k.unlock,
    getMyTourAccess: k.mine,
    getRestrictedTour: k.view,
  });
  // Stand-ins for verifyJwt() / verifyJwt(['contributor']): x-user = "<sub>:<role>".
  const userOf = (req) => {
    const [sub, role] = String(req.headers['x-user'] ?? '').split(':');
    return sub ? { sub, role } : null;
  };
  const requireAuth = (req, res, next) => {
    req.user = userOf(req);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
  const requireContributor = (req, res, next) => {
    req.user = userOf(req);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'contributor') return res.status(403).json({ error: 'Forbidden' });
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', buildTourAccessRouter({ tourAccessController: controller, requireAuth, requireContributor }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (user) headers['x-user'] = user;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { k, call, close: () => new Promise((r) => server.close(r)) };
}

test('HTTP: owner routes need a contributor, owner only, validation 400, never return the hash', async () => {
  const { call, close } = await startApp();
  const owner = `${AUTHOR}:contributor`;
  try {
    assert.equal((await call('GET', `/mine/${T_DRAFT}/access`)).status, 401);
    assert.equal((await call('GET', `/mine/${T_DRAFT}/access`, { user: 'tourist:tourist' })).status, 403);
    assert.equal((await call('GET', `/mine/${T_DRAFT}/access`, { user: 'other:contributor' })).status, 403);
    assert.equal((await call('GET', '/mine/not-a-uuid/access', { user: owner })).status, 400);
    const bad = await call('PUT', `/mine/${T_DRAFT}/access`, { user: owner, body: { passcode: '12 34 56' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Mã truy cập không được chứa khoảng trắng');
    assert.equal((await call('PUT', `/mine/${T_DRAFT}/access`, { user: owner, body: {} })).status, 400);

    const on = await call('PUT', `/mine/${T_DRAFT}/access`, { user: owner, body: { passcode: CODE } });
    assert.equal(on.status, 200);
    assert.equal(on.body.restricted, true);
    assert.ok(!JSON.stringify(on.body).includes('scrypt'));
    assert.equal((await call('PUT', `/mine/${T_PUBLIC}/access`, { user: owner, body: { passcode: CODE } })).body.code, 'tour_not_restrictable');
    const got = await call('GET', `/mine/${T_DRAFT}/access`, { user: owner });
    assert.deepEqual(Object.keys(got.body).sort(), ['passcodeSetAt', 'restricted', 'testers']);
    const off = await call('DELETE', `/mine/${T_DRAFT}/access`, { user: owner });
    assert.equal(off.status, 200);
    assert.equal(off.body.tour.status, 'draft');
    assert.ok(!JSON.stringify(off.body).includes('passcodeHash'));
    assert.equal((await call('DELETE', `/mine/${T_DRAFT}/access`, { user: owner })).status, 409);
  } finally {
    await close();
  }
});

test('HTTP: tester flow (any role): 401 signed out, 403 wrong, 200 unlock, view, 404 for others, 429', async () => {
  const { call, close } = await startApp();
  try {
    await call('PUT', `/mine/${T_DRAFT}/access`, { user: `${AUTHOR}:contributor`, body: { passcode: CODE } });
    assert.equal((await call('POST', `/${T_DRAFT}/unlock`, { body: { passcode: CODE } })).status, 401);
    assert.equal((await call('POST', `/${T_DRAFT}/unlock`, { user: 'u1:tourist', body: {} })).status, 400);
    const wrong = await call('POST', `/${T_DRAFT}/unlock`, { user: 'u1:tourist', body: { passcode: 'nope-nope' } });
    assert.deepEqual(wrong, { status: 403, body: { error: 'Mã truy cập không đúng', code: 'wrong_passcode' } });
    assert.deepEqual((await call('GET', `/${T_DRAFT}/access/mine`, { user: 'u1:tourist' })).body, { unlocked: false });
    assert.equal((await call('GET', `/${T_DRAFT}/restricted`, { user: 'u1:tourist' })).status, 404);

    assert.deepEqual(await call('POST', `/${T_DRAFT}/unlock`, { user: 'u1:tourist', body: { passcode: CODE } }), { status: 200, body: { unlocked: true } });
    assert.deepEqual((await call('GET', `/${T_DRAFT}/access/mine`, { user: 'u1:tourist' })).body, { unlocked: true });
    const view = await call('GET', `/${T_DRAFT}/restricted?lang=vi`, { user: 'u1:tourist' });
    assert.equal(view.status, 200);
    assert.equal(view.body.tour.id, T_DRAFT);
    assert.equal(view.body.tour.places.length, 1);
    assert.equal((await call('GET', `/${T_DRAFT}/restricted`, { user: 'u2:contributor' })).status, 404);
    assert.equal((await call('POST', `/${T_PUBLIC}/unlock`, { user: 'u1:tourist', body: { passcode: CODE } })).status, 404);

    for (let i = 0; i < 5; i += 1) await call('POST', `/${T_DRAFT}/unlock`, { user: 'u3:tourist', body: { passcode: `bad-${i}-x` } });
    const limited = await call('POST', `/${T_DRAFT}/unlock`, { user: 'u3:tourist', body: { passcode: CODE } });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'too_many_attempts');
  } finally {
    await close();
  }
});
