// Implements ModerationRepository on the ModerationResult model (task #AI-26).
// Unique key: (subjectType, subjectId, revision).
export class PrismaModerationRepository {
  constructor(prisma) { this.prisma = prisma; }
  async find(key) { throw new Error('not implemented: #AI-26'); }
  async createPending(row) { throw new Error('not implemented: #AI-26'); }
  async update(id, patch) { throw new Error('not implemented: #AI-26'); }
  async listRetryable(opts) { throw new Error('not implemented: #AI-29'); }
}
