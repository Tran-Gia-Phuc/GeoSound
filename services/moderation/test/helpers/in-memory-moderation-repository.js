// In-memory ModerationRepository for tests (task #AI-33). Same contract as the Prisma one.
import { randomUUID } from 'node:crypto';
import { CASE_STATUS } from '../../src/domain/entities/moderation-case.js';
import { pickMutable, DEFAULT_RETRY_LIMIT } from '../../src/infrastructure/persistence/prisma-moderation-repository.js';

const keyOf = ({ subjectType, subjectId, revision }) => `${subjectType}|${subjectId}|${revision}`;
const copy = (row) => (row ? structuredClone(row) : null);

export class InMemoryModerationRepository {
  /** @param {{ clock?: { now: () => Date } }} [opts] */
  constructor({ clock = { now: () => new Date() } } = {}) {
    this.clock = clock;
    this.rows = new Map(); // id -> row
    this.byKey = new Map(); // unique key -> id
  }

  async find(key) {
    const id = this.byKey.get(keyOf(key));
    return copy(id ? this.rows.get(id) : null);
  }

  async createPending({ subjectType, subjectId, tourId = null, revision, payload }) {
    const k = keyOf({ subjectType, subjectId, revision });
    if (this.byKey.has(k)) return copy(this.rows.get(this.byKey.get(k)));
    const now = this.clock.now();
    const row = {
      id: randomUUID(), subjectType, subjectId, tourId, revision,
      status: CASE_STATUS.PENDING, verdict: null, severity: null, reasons: [], attempts: 0,
      model: null, lastError: null, payload, publishedAt: null, checkedAt: null,
      createdAt: now, updatedAt: now,
    };
    this.rows.set(row.id, row);
    this.byKey.set(k, row.id);
    return copy(row);
  }

  async update(id, patch) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`moderation case not found: ${id}`);
    const next = { ...row, ...structuredClone(pickMutable(patch)), updatedAt: this.clock.now() };
    this.rows.set(id, next);
    return copy(next);
  }

  async listRetryable({ failedBefore, staleBefore, limit = DEFAULT_RETRY_LIMIT }) {
    const stale = [CASE_STATUS.PENDING, CASE_STATUS.REVIEWING];
    const finished = [CASE_STATUS.DONE, CASE_STATUS.FAILED_PERMANENT];
    return [...this.rows.values()]
      .filter((r) => (r.status === CASE_STATUS.AI_FAILED && r.updatedAt < failedBefore)
        || (stale.includes(r.status) && r.updatedAt < staleBefore)
        || (finished.includes(r.status) && r.publishedAt === null && r.updatedAt < staleBefore))
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, limit)
      .map(copy);
  }

  // Compare-and-set, same contract as PrismaModerationRepository.claim.
  async claim(id, { fromStatus, fromUpdatedAt, toStatus = fromStatus, patch = {}, now = this.clock.now() }) {
    const row = this.rows.get(id);
    if (!row || row.status !== fromStatus || row.updatedAt.getTime() !== new Date(fromUpdatedAt).getTime()) return null;
    const next = { ...row, ...structuredClone(pickMutable(patch)), status: toStatus, updatedAt: now };
    this.rows.set(id, next);
    return copy(next);
  }
}
