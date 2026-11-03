// =========================================================
// UC20 (#273) — impl of AdminActionRepository with Prisma (table admin_actions, decision L14).
// Append-only: the API has `append` and list methods only, never an update or a delete. `append`
// takes the caller's transaction client, so an admin action and its log row commit together.
// =========================================================
import { AdminAction, assertAdminActionEntry } from '../../domain/entities/admin-action.js';

const toEntity = (row) => (row ? new AdminAction(row) : null);
const HISTORY_LIMIT = 100;

/** @implements {import('../../domain/ports/index.js').AdminActionRepository} */
export class PrismaAdminActionRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
    Object.freeze(this);
  }

  /** Adds one row; `tx` = the interactive transaction of the action it records. */
  async append({ adminId, action, targetType, targetId, reason = null, data = {} }, { tx = this.prisma } = {}) {
    assertAdminActionEntry({ adminId, action, targetType, targetId });
    const row = await tx.adminAction.create({
      data: { adminId, action, targetType, targetId, reason: reason ?? null, data: data ?? {} },
    });
    return toEntity(row);
  }

  /** History of one target, newest first. */
  async listByTarget(targetType, targetId, { limit = HISTORY_LIMIT } = {}) {
    const rows = await this.prisma.adminAction.findMany({
      where: { targetType, targetId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toEntity);
  }

  /** Whole log, newest first, optionally filtered (UC22). */
  async listRecent({ skip = 0, take = 20, action, adminId } = {}) {
    const where = {};
    if (action) where.action = action;
    if (adminId) where.adminId = adminId;
    const [rows, total] = await Promise.all([
      this.prisma.adminAction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.adminAction.count({ where }),
    ]);
    return { items: rows.map(toEntity), total };
  }
}
