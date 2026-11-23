// =========================================================
// UC05 — PrismaTourRatingRepository with a rating the admin removed (is_hidden = true).
// Fake Prisma client: $transaction runs the callback, $queryRaw answers the lock and the aggregate
// UPDATE by their SQL text, tourRating.update / delete record their calls. No database.
//   node --test
// =========================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { PrismaTourRatingRepository } from '../src/infrastructure/persistence/prisma-tour-rating-repository.js';

// The repository builds SQL with Prisma.raw / Prisma.sql: they exist only once `prisma generate` ran
// (the image), not in the CI repo layout.
const skip = typeof Prisma.raw === 'function' ? false : 'Prisma client not generated';

function fakePrisma(ownRow) {
  const calls = { moves: [], updates: [], deletes: [] };
  const tx = {
    async $queryRaw(sql) {
      const text = sql.strings.join('?');
      if (text.includes('FOR UPDATE')) return ownRow ? [ownRow] : [];
      calls.moves.push({ count: sql.values[0], sum: sql.values[2] }); // values: count, count, sum, count, tourId
      return [{ averageRating: 4, ratingCount: 10 }];
    },
    tourRating: {
      async update({ where, data }) { calls.updates.push({ where, data }); return { id: where.id, tourId: 't1', userId: 'u1', ...data }; },
      async create({ data }) { return { id: 'new', ...data }; },
      async delete({ where }) { calls.deletes.push(where); },
    },
  };
  return { prisma: { $transaction: (fn) => fn(tx) }, calls };
}

const input = { tourId: 't1', userId: 'u1', userName: 'An', stars: 4, comment: 'Lại hay' };

test('rating again after an admin removal replaces the hidden row and counts it once', { skip }, async () => {
  const { prisma, calls } = fakePrisma({ id: 'r1', stars: 1, isHidden: true });
  const out = await new PrismaTourRatingRepository(prisma, { schema: 'tour' }).saveForUser(input);
  assert.equal(out.created, true);
  assert.equal(calls.updates[0].data.isHidden, false);
  assert.equal(calls.updates[0].data.isFlagged, false);
  assert.deepEqual(calls.moves, [{ count: 1, sum: 4 }]); // created(4), not updated(1 -> 4)
});

test('editing a visible rating still moves the aggregate by the difference', { skip }, async () => {
  const { prisma, calls } = fakePrisma({ id: 'r1', stars: 1, isHidden: false });
  const out = await new PrismaTourRatingRepository(prisma, { schema: 'tour' }).saveForUser(input);
  assert.equal(out.created, false);
  assert.equal('isHidden' in calls.updates[0].data, false);
  assert.deepEqual(calls.moves, [{ count: 0, sum: 3 }]);
});

test('deleting a removed rating is not found and does not subtract it again', { skip }, async () => {
  const { prisma, calls } = fakePrisma({ id: 'r1', stars: 5, isHidden: true });
  assert.equal(await new PrismaTourRatingRepository(prisma, { schema: 'tour' }).deleteForUser('t1', 'u1'), null);
  assert.deepEqual([calls.deletes.length, calls.moves.length], [0, 0]);
});
