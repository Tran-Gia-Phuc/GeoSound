// =========================================================
// UC23 / R7 — change the password while signed in: checks the current password, stores the
// new hash and signs out every other device (reason password_change); the current one stays.
// =========================================================
import { Password } from '../../domain/value-objects/password.js';
import {
  AccountBannedError,
  InvalidTokenError,
  ValidationError,
  WrongPasswordError,
} from '../../domain/errors/index.js';
import { REVOKE_REASONS } from '../../domain/entities/session.js';

export class ChangePassword {
  /** @param {{ userRepo, hasher, sessions: import('../services/session-manager.js').SessionManager }} deps */
  constructor({ userRepo, hasher, sessions }) {
    this.userRepo = userRepo;
    this.hasher = hasher;
    this.sessions = sessions;
  }

  /** @param {{ userId: string, currentSid?: string|null, currentPassword: string, newPassword: string }} input */
  async execute({ userId, currentSid = null, currentPassword, newPassword }) {
    const user = userId ? await this.userRepo.findById(userId) : null;
    if (!user) throw new InvalidTokenError();
    if (user.isBanned()) throw new AccountBannedError(user.banReason);

    if (!(await this.hasher.compare(String(currentPassword ?? ''), user.passwordHash))) {
      throw new WrongPasswordError();
    }
    const passwordVo = new Password(newPassword); // E6
    if (passwordVo.value === currentPassword) {
      throw new ValidationError('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    user.passwordHash = await this.hasher.hash(passwordVo.value);
    user.resetLockout();
    await this.userRepo.save(user);
    const revoked = await this.sessions.revokeAll(user.id, REVOKE_REASONS.PASSWORD_CHANGE, { exceptSid: currentSid });

    return { revoked };
  }
}
