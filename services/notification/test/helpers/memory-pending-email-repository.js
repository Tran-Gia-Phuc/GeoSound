// In-memory stand-in for PrismaPendingEmailRepository (same semantics: due = not given up and
// next_attempt_at <= now, oldest first; claim only when next_attempt_at is still the value read).
import { randomUUID } from 'node:crypto';

export class MemoryPendingEmailRepository {
  constructor() {
    this.rows = [];
    this.failNext = null;
  }

  async add(row) {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.rows.push({ id: randomUUID(), createdAt: new Date(), ...row });
  }

  async due(now, maxAttempts, take) {
    return this.rows
      .filter((r) => r.nextAttemptAt <= now && r.attempts < maxAttempts)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, take)
      .map((r) => ({ ...r }));
  }

  async claim(id, seenNextAttemptAt, data) {
    const row = this.rows.find((r) => r.id === id && r.nextAttemptAt.getTime() === seenNextAttemptAt.getTime());
    if (!row) return false;
    Object.assign(row, data);
    return true;
  }

  async remove(id) {
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  async recordError(id, lastError) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.lastError = lastError;
  }
}
