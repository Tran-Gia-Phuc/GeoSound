// =========================================================
// UC20 (#273) / UC22 (#275) — impl of AdminActionRepository with Prisma (table admin_actions,
// decision L14). Append-only: the API has append methods and reads only, never an update or a delete.
//   append      : inside the caller's transaction, so an admin action and its log row commit together
//   appendOnce  : rows fed by an event (account.moderated); the unique source_key makes a redelivered
//                 event a no-op (INSERT ... ON CONFLICT DO NOTHING through createMany skipDuplicates)
//   findById / listByTarget / listRecent : reads, newest first
// =========================================================
import { AdminAction, assertAdminActionEntry } from '../../domain/entities/admin-action.js';

const toEntity = (row) => (row ? new AdminAction(row) : null);
const HISTORY_LIMIT = 100;
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

/** Prisma where of the log filters (UC22). Period = [from, to). */
function logWhere({ action, adminId, targetType, targetId, from, to } = {}) {
  const where = {};
  if (action) where.action = action;
  if (adminId) where.adminId = adminId;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lt = to;
  }
  return where;
}

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

  /**
   * Adds one event-fed row unless a row with the same `sourceKey` exists. Returns true when added.
   * `createdAt` = the time of the action in the event (not the delivery time).
   */
  async appendOnce({ adminId, action, targetType, targetId, reason = null, data = {}, createdAt }, sourceKey) {
    assertAdminActionEntry({ adminId, action, targetType, targetId });
    if (!sourceKey) throw new Error('admin action: sourceKey is required');
    const { count } = await this.prisma.adminAction.createMany({
      data: [{
        adminId, action, targetType, targetId, reason: reason ?? null, data: data ?? {}, sourceKey,
        ...(createdAt ? { createdAt } : {}),
      }],
      skipDuplicates: true,
    });
    return count > 0;
  }

  async findById(id) {
    return toEntity(await this.prisma.adminAction.findUnique({ where: { id } }));
  }

  /** History of one target, newest first. */
  async listByTarget(targetType, targetId, { limit = HISTORY_LIMIT } = {}) {
    const rows = await this.prisma.adminAction.findMany({
      where: { targetType, targetId },
      orderBy: NEWEST_FIRST,
      take: limit,
    });
    return rows.map(toEntity);
  }

  /** Whole log, newest first, filtered by action / admin / target / period (UC22). */
  async listRecent({ skip = 0, take = 20, ...filters } = {}) {
    const where = logWhere(filters);
    const [rows, total] = await Promise.all([
      this.prisma.adminAction.findMany({ where, orderBy: NEWEST_FIRST, skip, take }),
      this.prisma.adminAction.count({ where }),
    ]);
    return { items: rows.map(toEntity), total };
  }
}
