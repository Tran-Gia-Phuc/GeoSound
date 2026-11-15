// ModerationRepository contract (task #AI-33), run against the in-memory repo and the Prisma repo
// backed by a small fake Prisma client. No real database, no @prisma/client import.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryModerationRepository } from './helpers/in-memory-moderation-repository.js';
import { FakeClock } from './helpers/fakes.js';
import { PrismaModerationRepository } from '../src/infrastructure/persistence/prisma-moderation-repository.js';

const MIN = 60_000;

// Fake of prisma.moderationCase: understands only the query shapes the repository sends,
// so a wrong where/data shape fails the test. Simulates @default, @updatedAt and P2002.
class FakePrisma {
  constructor(clock) {
    this.clock = clock;
    this.rows = [];
    this.calls = [];
    this.nextId = 1;
    const self = this;
    this.moderationCase = {
      async findUnique(args) { self.calls.push(['findUnique', args]); return self.findUnique(args); },
      async create(args) { self.calls.push(['create', args]); return self.create(args); },
      async update(args) { self.calls.push(['update', args]); return self.update(args); },
      async findMany(args) { self.calls.push(['findMany', args]); return self.findMany(args); },
      async updateMany(args) { self.calls.push(['updateMany', args]); return self.updateMany(args); },
    };
  }

  findUnique({ where }) {
    const k = where.subjectType_subjectId_revision;
    if (where.id) return structuredClone(this.rows.find((r) => r.id === where.id) ?? null);
    assert.ok(k, 'findUnique must use the compound unique key');
    const row = this.rows.find((r) => r.subjectType === k.subjectType
      && r.subjectId === k.subjectId && r.revision === k.revision);
    return structuredClone(row ?? null);
  }

  create({ data }) {
    if (this.rows.some((r) => r.subjectType === data.subjectType && r.subjectId === data.subjectId
      && r.revision === data.revision)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    const now = this.clock.now();
    const row = {
      id: `id-${this.nextId++}`, tourId: null, status: 'pending', verdict: null, severity: null,
      reasons: [], attempts: 0, model: null, imagesChecked: 0, lastError: null, publishedAt: null, checkedAt: null,
      ...structuredClone(data), createdAt: now, updatedAt: now,
    };
    this.rows.push(row);
    return structuredClone(row);
  }

  update({ where, data }) {
    const i = this.rows.findIndex((r) => r.id === where.id);
    if (i < 0) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
    this.rows[i] = { ...this.rows[i], ...structuredClone(data), updatedAt: this.clock.now() };
    return structuredClone(this.rows[i]);
  }

  // Only the CAS shape the repository sends: where { id, status, updatedAt } (exact match).
  updateMany({ where, data }) {
    assert.deepEqual(Object.keys(where).sort(), ['id', 'status', 'updatedAt']);
    const i = this.rows.findIndex((r) => r.id === where.id && r.status === where.status
      && r.updatedAt.getTime() === where.updatedAt.getTime());
    if (i < 0) return { count: 0 };
    this.rows[i] = { ...this.rows[i], ...structuredClone(data), updatedAt: data.updatedAt ?? this.clock.now() };
    return { count: 1 };
  }

  findMany({ where, orderBy, take }) {
    const match = (r, c) => {
      const statusOk = typeof c.status === 'string' ? r.status === c.status : c.status.in.includes(r.status);
      const publishedOk = !('publishedAt' in c) || r.publishedAt === c.publishedAt;
      return statusOk && publishedOk && r.updatedAt < c.updatedAt.lt;
    };
    assert.deepEqual(orderBy, { updatedAt: 'asc' });
    return this.rows
      .filter((r) => where.OR.some((c) => match(r, c)))
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, take)
      .map((r) => structuredClone(r));
  }
}

const place = (id = 'p1', revision = '2026-01-01T00:00:00.000Z') => ({
  subjectType: 'place', subjectId: id, tourId: 't1', revision,
  payload: { placeId: id, tourId: 't1', revision, name: 'Ben Thanh', description: 'Market', language: 'vi' },
});

const impls = {
  'in-memory': (clock) => ({ repo: new InMemoryModerationRepository({ clock }) }),
  prisma: (clock) => {
    const prisma = new FakePrisma(clock);
    return { repo: new PrismaModerationRepository(prisma), prisma };
  },
};

for (const [name, make] of Object.entries(impls)) {
  describe(`ModerationRepository contract: ${name}`, () => {
    test('find returns null for an unknown key', async () => {
      const { repo } = make(new FakeClock());
      assert.equal(await repo.find({ subjectType: 'place', subjectId: 'x', revision: 'r' }), null);
    });

    test('createPending stores a pending case with defaults; find returns it', async () => {
      const { repo } = make(new FakeClock());
      const created = await repo.createPending(place());
      assert.equal(created.status, 'pending');
      assert.equal(created.attempts, 0);
      assert.deepEqual(created.reasons, []);
      assert.equal(created.verdict, null);
      assert.equal(created.tourId, 't1');
      assert.equal(created.payload.name, 'Ben Thanh');
      assert.ok(created.id);
      assert.ok(created.createdAt instanceof Date);
      const found = await repo.find({ subjectType: 'place', subjectId: 'p1', revision: place().revision });
      assert.deepEqual(found, created);
    });

    test('tourId defaults to null (tour cases)', async () => {
      const { repo } = make(new FakeClock());
      const c = await repo.createPending({ subjectType: 'tour', subjectId: 't1', revision: 'r1', payload: {} });
      assert.equal(c.tourId, null);
    });

    test('createPending is idempotent on (subjectType, subjectId, revision)', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const first = await repo.createPending(place());
      await repo.update(first.id, { status: 'reviewing', attempts: 1 });
      clock.advance(MIN);
      const again = await repo.createPending({ ...place(), payload: { other: true } });
      assert.equal(again.id, first.id);
      assert.equal(again.status, 'reviewing');
      assert.equal(again.payload.name, 'Ben Thanh');
    });

    test('a new revision, subject id or subject type is a new case', async () => {
      const { repo } = make(new FakeClock());
      const a = await repo.createPending(place('p1', 'r1'));
      const b = await repo.createPending(place('p1', 'r2'));
      const c = await repo.createPending(place('p2', 'r1'));
      const d = await repo.createPending({ ...place('p1', 'r1'), subjectType: 'tour' });
      assert.equal(new Set([a.id, b.id, c.id, d.id]).size, 4);
    });

    test('update writes known fields, ignores the rest, and refreshes updatedAt', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const c = await repo.createPending(place());
      clock.advance(MIN);
      const reasons = [{ field: 'description', category: 'misleading', message: 'm', source: 'ai' }];
      const checkedAt = clock.now();
      const u = await repo.update(c.id, {
        status: 'done', verdict: 'Warning', severity: 0.5, reasons, model: 'gemini-2.5-flash',
        checkedAt, attempts: 1,
        id: 'hacked', subjectId: 'hacked', revision: 'hacked', createdAt: new Date(0), bogus: 1,
      });
      assert.equal(u.id, c.id);
      assert.equal(u.subjectId, 'p1');
      assert.equal(u.revision, c.revision);
      assert.deepEqual(u.createdAt, c.createdAt);
      assert.equal('bogus' in u, false);
      assert.equal(u.status, 'done');
      assert.equal(u.verdict, 'Warning');
      assert.equal(u.severity, 0.5);
      assert.deepEqual(u.reasons, reasons);
      assert.equal(u.model, 'gemini-2.5-flash');
      assert.deepEqual(u.checkedAt, checkedAt);
      assert.ok(u.updatedAt > c.updatedAt);
      assert.deepEqual(await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision }), u);
    });

    test('imagesChecked defaults to 0 and is stored by update', async () => {
      const { repo } = make(new FakeClock());
      const c = await repo.createPending(place());
      assert.equal(c.imagesChecked, 0);
      const u = await repo.update(c.id, { status: 'done', verdict: 'Pass', imagesChecked: 3 });
      assert.equal(u.imagesChecked, 3);
      assert.equal((await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision })).imagesChecked, 3);
    });

    test('returned rows are copies, not live references', async () => {
      const { repo } = make(new FakeClock());
      const c = await repo.createPending(place());
      c.status = 'done';
      c.payload.name = 'changed';
      const found = await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision });
      assert.equal(found.status, 'pending');
      assert.equal(found.payload.name, 'Ben Thanh');
    });

    test('listRetryable: old ai_failed and stale pending/reviewing, oldest first, limit', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const mk = async (id, status) => {
        const c = await repo.createPending(place(id));
        // Published finished cases are never retried; publishedAt is set together with the status here.
        const publishedAt = status === 'done' || status === 'failed_permanent' ? clock.now() : undefined;
        if (status !== 'pending') await repo.update(c.id, { status, publishedAt });
        clock.advance(MIN);
        return c.id;
      };
      // Created one minute apart: t0..t5.
      await mk('failedOld', 'ai_failed'); // t0
      await mk('pendingOld', 'pending'); // t1
      await mk('reviewingOld', 'reviewing'); // t2
      await mk('doneOld', 'done'); // t3, published: never retried
      await mk('permanentOld', 'failed_permanent'); // t4, published: never retried
      await mk('failedNew', 'ai_failed'); // t5
      // ai_failed updated before t3, pending/reviewing updated before t2 (strictly less than).
      const t0 = new FakeClock().now().getTime();
      const failedBefore = new Date(t0 + 3 * MIN);
      const staleBefore = new Date(t0 + 2 * MIN);

      const ids = (rows) => rows.map((r) => r.subjectId);
      assert.deepEqual(ids(await repo.listRetryable({ failedBefore, staleBefore })), ['failedOld', 'pendingOld']);
      assert.deepEqual(
        ids(await repo.listRetryable({ failedBefore: new Date(t0 + 6 * MIN), staleBefore: new Date(t0 + 6 * MIN) })),
        ['failedOld', 'pendingOld', 'reviewingOld', 'failedNew'],
      );
      assert.deepEqual(
        ids(await repo.listRetryable({ failedBefore: new Date(t0 + 6 * MIN), staleBefore: new Date(t0 + 6 * MIN), limit: 2 })),
        ['failedOld', 'pendingOld'],
      );
      assert.deepEqual(await repo.listRetryable({ failedBefore: new Date(t0), staleBefore: new Date(t0) }), []);
    });

    test('listRetryable: done/failed_permanent with publishedAt null are returned once stale', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const t0 = clock.now().getTime();
      const done = await repo.createPending(place('doneUnpublished'));
      await repo.update(done.id, { status: 'done', verdict: 'Pass' });
      const perm = await repo.createPending(place('permUnpublished'));
      await repo.update(perm.id, { status: 'failed_permanent', verdict: 'Warning' });
      const pub = await repo.createPending(place('donePublished'));
      await repo.update(pub.id, { status: 'done', verdict: 'Pass', publishedAt: clock.now() });
      clock.advance(MIN);
      const ids = (rows) => rows.map((r) => r.subjectId).sort();
      // failedBefore does not matter for finished cases; staleBefore does.
      assert.deepEqual(ids(await repo.listRetryable({ failedBefore: new Date(t0 + MIN), staleBefore: new Date(t0) })), []);
      assert.deepEqual(
        ids(await repo.listRetryable({ failedBefore: new Date(t0), staleBefore: new Date(t0 + MIN) })),
        ['doneUnpublished', 'permUnpublished'],
      );
    });

    test('claim: compare-and-set on status and updatedAt, moves status, applies patch, sets updatedAt', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const c = await repo.createPending(place());
      const failed = await repo.update(c.id, { status: 'ai_failed', attempts: 1 });
      clock.advance(MIN);
      const now = clock.now();
      const claimed = await repo.claim(c.id, {
        fromStatus: 'ai_failed', fromUpdatedAt: failed.updatedAt, toStatus: 'reviewing',
        patch: { attempts: 2, id: 'hacked', status: 'done' }, now,
      });
      assert.equal(claimed.id, c.id);
      assert.equal(claimed.status, 'reviewing');
      assert.equal(claimed.attempts, 2);
      assert.deepEqual(claimed.updatedAt, now);
      assert.deepEqual(await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision }), claimed);
    });

    test('claim: a second claim with the same snapshot loses (returns null, row unchanged)', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const c = await repo.createPending(place());
      clock.advance(MIN);
      const snapshot = { fromStatus: 'pending', fromUpdatedAt: c.updatedAt, toStatus: 'reviewing', now: clock.now() };
      const first = await repo.claim(c.id, { ...snapshot, patch: { attempts: 1 } });
      assert.ok(first);
      assert.equal(await repo.claim(c.id, { ...snapshot, patch: { attempts: 1 } }), null);
      assert.deepEqual(await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision }), first);
    });

    test('claim: null on a status or updatedAt mismatch and for an unknown id', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const c = await repo.createPending(place());
      clock.advance(MIN);
      const now = clock.now();
      assert.equal(await repo.claim(c.id, { fromStatus: 'ai_failed', fromUpdatedAt: c.updatedAt, toStatus: 'reviewing', now }), null);
      assert.equal(await repo.claim(c.id, { fromStatus: 'pending', fromUpdatedAt: new Date(c.updatedAt.getTime() - 1), now }), null);
      assert.equal(await repo.claim('nope', { fromStatus: 'pending', fromUpdatedAt: c.updatedAt, now }), null);
      assert.equal((await repo.find({ subjectType: 'place', subjectId: 'p1', revision: c.revision })).status, 'pending');
    });

    test('claim without toStatus keeps the status and only refreshes updatedAt (lease)', async () => {
      const clock = new FakeClock();
      const { repo } = make(clock);
      const c = await repo.createPending(place());
      const done = await repo.update(c.id, { status: 'done', verdict: 'Pass' });
      clock.advance(MIN);
      const leased = await repo.claim(c.id, { fromStatus: 'done', fromUpdatedAt: done.updatedAt, now: clock.now() });
      assert.equal(leased.status, 'done');
      assert.equal(leased.verdict, 'Pass');
      assert.ok(leased.updatedAt > done.updatedAt);
    });
  });
}

describe('PrismaModerationRepository query shapes', () => {
  test('find uses the compound unique key', async () => {
    const prisma = new FakePrisma(new FakeClock());
    await new PrismaModerationRepository(prisma).find({ subjectType: 'place', subjectId: 'p1', revision: 'r1' });
    assert.deepEqual(prisma.calls, [['findUnique', {
      where: { subjectType_subjectId_revision: { subjectType: 'place', subjectId: 'p1', revision: 'r1' } },
    }]]);
  });

  test('createPending sends only creation fields with status pending', async () => {
    const prisma = new FakePrisma(new FakeClock());
    const p = place();
    await new PrismaModerationRepository(prisma).createPending(p);
    assert.deepEqual(prisma.calls, [['create', {
      data: { subjectType: 'place', subjectId: 'p1', tourId: 't1', revision: p.revision, payload: p.payload, status: 'pending' },
    }]]);
  });

  test('createPending on P2002 looks up and returns the existing row', async () => {
    const prisma = new FakePrisma(new FakeClock());
    const repo = new PrismaModerationRepository(prisma);
    const first = await repo.createPending(place());
    prisma.calls.length = 0;
    const again = await repo.createPending(place());
    assert.equal(again.id, first.id);
    assert.deepEqual(prisma.calls.map(([m]) => m), ['create', 'findUnique']);
  });

  test('createPending rethrows other errors', async () => {
    const boom = Object.assign(new Error('db down'), { code: 'P1001' });
    const prisma = { moderationCase: { async create() { throw boom; }, async findUnique() { return null; } } };
    await assert.rejects(new PrismaModerationRepository(prisma).createPending(place()), boom);
  });

  test('update sends where id and only mutable fields', async () => {
    const prisma = new FakePrisma(new FakeClock());
    const repo = new PrismaModerationRepository(prisma);
    const c = await repo.createPending(place());
    prisma.calls.length = 0;
    await repo.update(c.id, { status: 'ai_failed', lastError: 'timeout', id: 'x', updatedAt: new Date(0), verdict: undefined });
    assert.deepEqual(prisma.calls, [['update', { where: { id: c.id }, data: { status: 'ai_failed', lastError: 'timeout' } }]]);
  });

  test('listRetryable sends the OR filter, ordering and default limit', async () => {
    const prisma = new FakePrisma(new FakeClock());
    const failedBefore = new Date('2026-01-01T00:00:00.000Z');
    const staleBefore = new Date('2026-01-01T00:05:00.000Z');
    await new PrismaModerationRepository(prisma).listRetryable({ failedBefore, staleBefore });
    assert.deepEqual(prisma.calls, [['findMany', {
      where: {
        OR: [
          { status: 'ai_failed', updatedAt: { lt: failedBefore } },
          { status: { in: ['pending', 'reviewing'] }, updatedAt: { lt: staleBefore } },
          { status: { in: ['done', 'failed_permanent'] }, publishedAt: null, updatedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    }]]);
  });

  test('claim sends updateMany with the CAS where and only mutable fields, then findUnique by id', async () => {
    const prisma = new FakePrisma(new FakeClock());
    const repo = new PrismaModerationRepository(prisma);
    const c = await repo.createPending(place());
    prisma.calls.length = 0;
    const now = new Date('2026-01-01T00:10:00.000Z');
    await repo.claim(c.id, {
      fromStatus: 'pending', fromUpdatedAt: c.updatedAt, toStatus: 'reviewing', patch: { attempts: 1, bogus: 1 }, now,
    });
    assert.deepEqual(prisma.calls, [
      ['updateMany', {
        where: { id: c.id, status: 'pending', updatedAt: c.updatedAt },
        data: { attempts: 1, status: 'reviewing', updatedAt: now },
      }],
      ['findUnique', { where: { id: c.id } }],
    ]);
  });

  test('claim with count 0 returns null without reading the row', async () => {
    const prisma = { moderationCase: { async updateMany() { return { count: 0 }; }, async findUnique() { throw new Error('must not read'); } } };
    const res = await new PrismaModerationRepository(prisma).claim('id-1', { fromStatus: 'pending', fromUpdatedAt: new Date(0), now: new Date() });
    assert.equal(res, null);
  });

  test('toPlain maps missing json reasons to [] and null to null', () => {
    assert.equal(PrismaModerationRepository.toPlain(null), null);
    const plain = PrismaModerationRepository.toPlain({ id: '1', subjectType: 'tour', subjectId: 't', revision: 'r', status: 'pending', reasons: null });
    assert.deepEqual(plain.reasons, []);
    assert.equal(plain.tourId, null);
    assert.equal(plain.attempts, 0);
    assert.equal(plain.imagesChecked, 0);
  });
});
