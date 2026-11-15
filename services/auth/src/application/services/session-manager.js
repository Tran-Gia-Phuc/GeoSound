// =========================================================
// UC23 — shared session logic used by the login, refresh, logout, device list,
// password reset and ban use cases (docs/02-design/device-sessions.md section 5).
//   start()     : create a session (replacing the active one of the same deviceId, R1),
//                 enforce the cap (R9), send the new-device alert (R10)
//   revoke()    : end one session + mark its sid in the revocation store (5.3)
//   revokeAll() : end every active session of a user (R7), optionally keeping one
// =========================================================
import { randomUUID } from 'node:crypto';
import { Session, REVOKE_REASONS } from '../../domain/entities/session.js';
import { deviceNameFromUserAgent } from '../../domain/value-objects/device-name.js';

export const NEW_DEVICE_LOGIN_EVENT = 'auth.new_device_login';

export class SessionManager {
  /**
   * @param {{
   *   sessionRepo: import('../../domain/ports/index.js').SessionRepository,
   *   tokens: import('../../domain/ports/index.js').TokenService,
   *   revocations: import('../../domain/ports/index.js').RevocationStore,
   *   locator?: import('../../domain/ports/index.js').LocationResolver,
   *   publisher?: import('../../domain/ports/index.js').EventPublisher|null,
   *   policy: { idleDays: number, maxDays: number, maxSessions: number },
   *   now?: () => Date, newId?: () => string, logger?: Console,
   * }} deps
   */
  constructor({ sessionRepo, tokens, revocations, locator, publisher, policy, now, newId, logger }) {
    this.sessionRepo = sessionRepo;
    this.tokens = tokens;
    this.revocations = revocations;
    this.locator = locator ?? { resolve: async () => null };
    this.publisher = publisher ?? null;
    this.policy = policy;
    this.now = now ?? (() => new Date());
    this.newId = newId ?? randomUUID;
    this.logger = logger ?? console;
  }

  /**
   * Sign-in on a device: returns tokens that carry the new `sid`.
   * @param {{ user, deviceId?: string|null, userAgent?: string|null, ip?: string|null, alert?: boolean }} input
   *   alert=false skips the new-device email (used when an old token without sid is upgraded)
   */
  async start({ user, deviceId = null, userAgent = null, ip = null, alert = true }) {
    const now = this.now();

    // R1 — same device: its active session is replaced. A device seen before is not "new" (R10).
    let isNewDevice = true;
    if (deviceId) {
      const previous = await this.sessionRepo.findLatestByDevice(user.id, deviceId);
      if (previous) {
        isNewDevice = false;
        if (previous.isActive(now)) await this.revoke(previous, REVOKE_REASONS.USER);
      }
    }

    const id = this.newId();
    const issued = this.tokens.issueTokens(user, { sid: id });
    const location = await this.#locate(ip);
    const session = Session.start(
      {
        id,
        userId: user.id,
        deviceId,
        deviceName: deviceNameFromUserAgent(userAgent),
        userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
        ipAddress: ip,
        location,
        refreshHash: this.tokens.hashRefresh(issued.refreshToken),
      },
      this.policy,
      now,
    );
    await this.sessionRepo.create(session);

    await this.#enforceCap(user.id, session.id, now);
    if (alert && isNewDevice) await this.#alert(user, session, now);

    return { session, tokens: issued };
  }

  /** End one session (idempotent) and make its access token unusable at once (5.3). */
  async revoke(session, reason) {
    if (session.isRevoked()) return false;
    session.revoke(reason, this.now());
    await this.sessionRepo.save(session);
    try {
      await this.revocations.markRevoked(session.id);
    } catch (err) {
      // The session is ended in the DB anyway; the access token then lives until it expires.
      this.logger.warn(`[auth] could not mark session ${session.id} revoked: ${err.message}`);
    }
    return true;
  }

  /**
   * End every active session of a user (R7), except `exceptSid` when given (R5).
   * @returns {Promise<number>} how many were ended
   */
  async revokeAll(userId, reason, { exceptSid = null } = {}) {
    const active = await this.sessionRepo.listActiveByUser(userId, this.now());
    let count = 0;
    for (const s of active) {
      if (s.id === exceptSid) continue;
      if (await this.revoke(s, reason)) count += 1;
    }
    return count;
  }

  // R9 — past the cap, the least recently active sessions are signed out (never the new one).
  async #enforceCap(userId, keepId, now) {
    const max = this.policy.maxSessions;
    if (!Number.isFinite(max) || max < 1) return;
    const active = await this.sessionRepo.listActiveByUser(userId, now);
    const extra = active.length - max;
    if (extra <= 0) return;
    const oldest = active
      .filter((s) => s.id !== keepId)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, extra);
    for (const s of oldest) await this.revoke(s, REVOKE_REASONS.LIMIT);
  }

  async #locate(ip) {
    try {
      return (await this.locator.resolve(ip)) ?? null;
    } catch {
      return null; // location is best effort (R12)
    }
  }

  // R10 — a failed publish never fails the sign-in.
  async #alert(user, session, now) {
    if (!this.publisher) return;
    const payload = {
      userId: user.id,
      email: user.email,
      deviceName: session.deviceName,
      at: now.toISOString(),
    };
    if (session.location) payload.location = session.location;
    try {
      await this.publisher.publish(NEW_DEVICE_LOGIN_EVENT, payload);
    } catch (err) {
      this.logger.warn(`[auth] ${NEW_DEVICE_LOGIN_EVENT} not published: ${err.message}`);
    }
  }
}
