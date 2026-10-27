// Implements the ModerationRepository port on the ModerationCase model (task #AI-33).
// Unique key: (subjectType, subjectId, revision). Prisma is injected so tests pass a fake.
import { CASE_STATUS } from '../../domain/entities/moderation-case.js';

// Fields a use-case may change after creation; anything else in a patch is ignored.
export const MUTABLE_FIELDS = Object.freeze([
  'status', 'verdict', 'severity', 'reasons', 'attempts', 'model', 'lastError',
  'payload', 'publishedAt', 'checkedAt', 'tourId',
]);
export const DEFAULT_RETRY_LIMIT = 50;

export function pickMutable(patch = {}) {
  const data = {};
  for (const k of MUTABLE_FIELDS) if (patch[k] !== undefined) data[k] = patch[k];
  return data;
}

/** @implements {import('../../domain/ports/index.js').ModerationRepository} */
export class PrismaModerationRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) { this.prisma = prisma; }

  /** Prisma row -> plain object. */
  static toPlain(row) {
    if (!row) return null;
    return {
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      tourId: row.tourId ?? null,
      revision: row.revision,
      status: row.status,
      verdict: row.verdict ?? null,
      severity: row.severity ?? null,
      reasons: Array.isArray(row.reasons) ? row.reasons : [],
      attempts: row.attempts ?? 0,
      model: row.model ?? null,
      lastError: row.lastError ?? null,
      payload: row.payload ?? null,
      publishedAt: row.publishedAt ?? null,
      checkedAt: row.checkedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async find({ subjectType, subjectId, revision }) {
    const row = await this.prisma.moderationCase.findUnique({
      where: { subjectType_subjectId_revision: { subjectType, subjectId, revision } },
    });
    return PrismaModerationRepository.toPlain(row);
  }

  async createPending({ subjectType, subjectId, tourId = null, revision, payload }) {
    try {
      const row = await this.prisma.moderationCase.create({
        data: { subjectType, subjectId, tourId, revision, payload, status: CASE_STATUS.PENDING },
      });
      return PrismaModerationRepository.toPlain(row);
    } catch (err) {
      // Duplicate event (D10): the case already exists, return it unchanged.
      if (err?.code === 'P2002') {
        const existing = await this.find({ subjectType, subjectId, revision });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async update(id, patch) {
    const row = await this.prisma.moderationCase.update({ where: { id }, data: pickMutable(patch) });
    return PrismaModerationRepository.toPlain(row);
  }

  async listRetryable({ failedBefore, staleBefore, limit = DEFAULT_RETRY_LIMIT }) {
    const rows = await this.prisma.moderationCase.findMany({
      where: {
        OR: [
          { status: CASE_STATUS.AI_FAILED, updatedAt: { lt: failedBefore } },
          { status: { in: [CASE_STATUS.PENDING, CASE_STATUS.REVIEWING] }, updatedAt: { lt: staleBefore } },
          // Result saved but its publish failed: the sweeper re-publishes it.
          {
            status: { in: [CASE_STATUS.DONE, CASE_STATUS.FAILED_PERMANENT] },
            publishedAt: null,
            updatedAt: { lt: staleBefore },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(PrismaModerationRepository.toPlain);
  }

  // Compare-and-set: writes only if the row still has fromStatus and fromUpdatedAt (nobody touched it since it
  // was read). updatedAt becomes `now`, so every other holder of the old snapshot loses. Returns the row or null.
  async claim(id, { fromStatus, fromUpdatedAt, toStatus = fromStatus, patch = {}, now = new Date() }) {
    const { count } = await this.prisma.moderationCase.updateMany({
      where: { id, status: fromStatus, updatedAt: fromUpdatedAt },
      data: { ...pickMutable(patch), status: toStatus, updatedAt: now },
    });
    if (count === 0) return null;
    const row = await this.prisma.moderationCase.findUnique({ where: { id } });
    return PrismaModerationRepository.toPlain(row);
  }
}
