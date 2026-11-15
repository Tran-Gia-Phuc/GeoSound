// =========================================================
// UC21 — admin actions on an account: warn, suspend (1 / 7 / 30 days or an end date, at most 365
// days, L13), ban, restore (A1). Design: docs/02-design/uc21-account-actions.md.
//   - never on the admin's own account (403 self_action) nor on another admin (403 target_is_admin)
//   - status writes are conditional on the state read (updateStatusIf): of two admins acting at
//     once only one wins, the other gets 409 account_state_changed
//   - suspend and ban sign the user out of every device at once (RevokeAllSessions, UC23 R7)
//   - every action publishes account.moderated (Notification emails the user and adds an in-app
//     notification; UC22 logs it later). A failed publish is only logged.
//   - warnings never escalate automatically (L13)
// =========================================================
import { User, ROLES, USER_STATUS } from '../../domain/entities/user.js';
import { REVOKE_REASONS } from '../../domain/entities/session.js';
import {
  AccountNotFoundError,
  SelfActionError,
  TargetIsAdminError,
  AccountNotRestrictedError,
  AccountAlreadyBannedError,
  AccountStateChangedError,
  InvalidSuspensionError,
} from '../../domain/errors/index.js';

export const ACCOUNT_MODERATED_EVENT = 'account.moderated';
export const ACCOUNT_ACTIONS = Object.freeze({ WARN: 'warn', SUSPEND: 'suspend', BAN: 'ban', RESTORE: 'restore' });
export const SUSPEND_PRESET_DAYS = Object.freeze([1, 7, 30]);
export const MAX_SUSPEND_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared steps of every action.
 * deps: userRepo, revokeAllSessions (RevokeAllSessions use case), publisher (EventPublisher port),
 * now, logger.
 */
class AccountAction {
  constructor({ userRepo, revokeAllSessions = null, publisher = null, now, logger }) {
    this.userRepo = userRepo;
    this.revokeAllSessions = revokeAllSessions;
    this.publisher = publisher;
    this.now = now ?? (() => new Date());
    this.logger = logger ?? console;
  }

  /** Target account, after the self / admin guards. */
  async loadTarget(userId, adminId) {
    if (userId && adminId && String(userId) === String(adminId)) throw new SelfActionError();
    const user = userId ? await this.userRepo.findById(String(userId)) : null;
    if (!user) throw new AccountNotFoundError(); // E1
    if (user.role === ROLES.ADMIN) throw new TargetIsAdminError();
    return user;
  }

  /** Conditional write on the state that was read; 409 when another admin moved it first. */
  async write(user, next) {
    const ok = await this.userRepo.updateStatusIf(user.id, user.stateSnapshot(), next);
    if (!ok) throw new AccountStateChangedError();
    Object.assign(user, next);
  }

  /** Sign out every device; the status change is already saved, so a failure is only logged. */
  async signOutEverywhere(userId, reason) {
    if (!this.revokeAllSessions) return null;
    try {
      const { revoked } = await this.revokeAllSessions.execute({ userId, reason });
      return revoked;
    } catch (err) {
      this.logger.warn(`[auth] UC21 could not sign out the devices of ${userId}: ${err.message}`);
      return null;
    }
  }

  async publish(user, { action, reason, until, adminId, at }) {
    if (!this.publisher) return;
    const payload = { userId: user.id, action, adminId: String(adminId), email: user.email, at: at.toISOString() };
    if (reason) payload.reason = reason;
    if (until) payload.until = until.toISOString();
    if (user.fullName) payload.fullName = user.fullName;
    try {
      await this.publisher.publish(ACCOUNT_MODERATED_EVENT, payload);
    } catch (err) {
      this.logger.warn(`[auth] ${ACCOUNT_MODERATED_EVENT} (${action}, userId=${user.id}) not published: ${err.message}`);
    }
  }
}

export class WarnUser extends AccountAction {
  /** @param {{ userId: string, adminId: string, reason: string }} input */
  async execute({ userId, adminId, reason }) {
    const user = await this.loadTarget(userId, adminId);
    if (user.isBanned()) throw new AccountAlreadyBannedError();
    const now = this.now();
    // No status change (L13: warnings never escalate automatically).
    await this.publish(user, { action: ACCOUNT_ACTIONS.WARN, reason, adminId, at: now });
    return { action: ACCOUNT_ACTIONS.WARN, user: user.toAdminView(now) };
  }
}

/**
 * End of a suspension: `days` (1, 7, 30) from now, or `until` (future, at most 365 days ahead).
 * @param {{ days?: number, until?: string|Date }} input @param {Date} now
 */
export function suspensionEnd({ days, until }, now) {
  if (days !== undefined && days !== null) {
    if (!SUSPEND_PRESET_DAYS.includes(Number(days))) throw new InvalidSuspensionError('Số ngày tạm khoá chỉ có thể là 1, 7 hoặc 30');
    return new Date(now.getTime() + Number(days) * DAY_MS);
  }
  const end = until instanceof Date ? until : new Date(String(until ?? ''));
  if (!Number.isFinite(end.getTime())) throw new InvalidSuspensionError('Vui lòng chọn thời hạn tạm khoá');
  if (end.getTime() <= now.getTime()) throw new InvalidSuspensionError('Thời hạn tạm khoá phải ở tương lai');
  if (end.getTime() > now.getTime() + MAX_SUSPEND_DAYS * DAY_MS) {
    throw new InvalidSuspensionError(`Thời hạn tạm khoá tối đa ${MAX_SUSPEND_DAYS} ngày`);
  }
  return end;
}

export class SuspendUser extends AccountAction {
  /** @param {{ userId: string, adminId: string, reason: string, days?: number, until?: string }} input */
  async execute({ userId, adminId, reason, days, until }) {
    const now = this.now();
    const end = suspensionEnd({ days, until }, now);
    const user = await this.loadTarget(userId, adminId);
    if (user.isBanned()) throw new AccountAlreadyBannedError();
    // A suspended account can be suspended again: the new end date replaces the old one.
    await this.write(user, User.suspended(reason, end));
    const sessionsRevoked = await this.signOutEverywhere(user.id, REVOKE_REASONS.SUSPENDED);
    await this.publish(user, { action: ACCOUNT_ACTIONS.SUSPEND, reason, until: end, adminId, at: now });
    return { action: ACCOUNT_ACTIONS.SUSPEND, user: user.toAdminView(now), sessionsRevoked };
  }
}

export class BanUser extends AccountAction {
  /** @param {{ userId: string, adminId: string, reason: string }} input */
  async execute({ userId, adminId, reason }) {
    const user = await this.loadTarget(userId, adminId);
    if (user.isBanned()) throw new AccountAlreadyBannedError();
    const now = this.now();
    await this.write(user, User.banned(reason));
    const sessionsRevoked = await this.signOutEverywhere(user.id, REVOKE_REASONS.BANNED);
    await this.publish(user, { action: ACCOUNT_ACTIONS.BAN, reason, adminId, at: now });
    return { action: ACCOUNT_ACTIONS.BAN, user: user.toAdminView(now), sessionsRevoked };
  }
}

export class RestoreUser extends AccountAction {
  /** @param {{ userId: string, adminId: string, reason?: string }} input */
  async execute({ userId, adminId, reason }) {
    const user = await this.loadTarget(userId, adminId);
    const now = this.now();
    // An ended suspension already reads as active: nothing to restore.
    if (user.effectiveStatus(now) === USER_STATUS.ACTIVE) throw new AccountNotRestrictedError();
    await this.write(user, User.restored());
    await this.publish(user, { action: ACCOUNT_ACTIONS.RESTORE, reason: reason || undefined, adminId, at: now });
    return { action: ACCOUNT_ACTIONS.RESTORE, user: user.toAdminView(now) };
  }
}
