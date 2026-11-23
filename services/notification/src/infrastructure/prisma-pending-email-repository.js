// =========================================================
// Prisma repository of pending_emails (schema "notification"), used by application/email-outbox.js.
// claim() is a conditional update (id + the next_attempt_at that was read), so two replicas never
// send the same row in one sweep.
// =========================================================

export class PrismaPendingEmailRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  async add(row) {
    await this.prisma.pendingEmail.create({ data: row });
  }

  /** Rows due now and not given up, oldest first. */
  async due(now, maxAttempts, take) {
    return this.prisma.pendingEmail.findMany({
      where: { nextAttemptAt: { lte: now }, attempts: { lt: maxAttempts } },
      orderBy: { nextAttemptAt: 'asc' },
      take,
    });
  }

  /** @returns {Promise<boolean>} true when this caller won the row. */
  async claim(id, seenNextAttemptAt, data) {
    const { count } = await this.prisma.pendingEmail.updateMany({ where: { id, nextAttemptAt: seenNextAttemptAt }, data });
    return count === 1;
  }

  async remove(id) {
    await this.prisma.pendingEmail.deleteMany({ where: { id } });
  }

  async recordError(id, lastError) {
    await this.prisma.pendingEmail.updateMany({ where: { id }, data: { lastError } });
  }
}
