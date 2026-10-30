// =========================================================
// UC23 / R12 — retention: sessions that ended (signed out or expired) more than
// `retentionDays` ago are deleted with their IP and User-Agent. Run on an interval (index.js).
// =========================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export class PurgeEndedSessions {
  /** @param {{ sessionRepo, retentionDays: number, now?: () => Date }} deps */
  constructor({ sessionRepo, retentionDays, now }) {
    this.sessionRepo = sessionRepo;
    this.retentionDays = retentionDays;
    this.now = now ?? (() => new Date());
  }

  async execute() {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * DAY_MS);
    const deleted = await this.sessionRepo.deleteEndedBefore(cutoff);
    return { deleted, cutoff };
  }
}
