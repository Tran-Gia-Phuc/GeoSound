// =========================================================
// UC21 — admin view of accounts: search (paged, newest first) and one account with its number of
// signed-in devices. Items never carry the password hash, OTP or sign-in lock data
// (User.toAdminView). Design: docs/02-design/uc21-account-actions.md.
// =========================================================
import { AccountNotFoundError } from '../../domain/errors/index.js';

export const ADMIN_USERS_DEFAULT_LIMIT = 20;
export const ADMIN_USERS_MAX_LIMIT = 50;

export class SearchUsers {
  /** @param {{ userRepo: import('../../domain/ports/index.js').UserRepository, now?: () => Date }} deps */
  constructor({ userRepo, now }) {
    this.userRepo = userRepo;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ q?: string, role?: string, status?: string, page?: number, limit?: number }} input */
  async execute({ q, role, status, page = 1, limit = ADMIN_USERS_DEFAULT_LIMIT } = {}) {
    const now = this.now();
    const take = Math.min(Math.max(Math.trunc(limit) || ADMIN_USERS_DEFAULT_LIMIT, 1), ADMIN_USERS_MAX_LIMIT);
    const current = Math.max(Math.trunc(page) || 1, 1);
    const query = q && String(q).trim() ? String(q).trim() : undefined;
    const { items, total } = await this.userRepo.search({
      q: query,
      role: role || undefined,
      status: status || undefined,
      skip: (current - 1) * take,
      take,
      now,
    });
    return { items: items.map((u) => u.toAdminView(now)), total, page: current, limit: take };
  }
}

export class GetUserForAdmin {
  /**
   * @param {{ userRepo: import('../../domain/ports/index.js').UserRepository,
   *           sessionRepo: import('../../domain/ports/index.js').SessionRepository, now?: () => Date }} deps
   */
  constructor({ userRepo, sessionRepo, now }) {
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
    this.now = now ?? (() => new Date());
  }

  /** @param {{ userId: string }} input */
  async execute({ userId }) {
    const user = userId ? await this.userRepo.findById(String(userId)) : null;
    if (!user) throw new AccountNotFoundError(); // E1
    const now = this.now();
    const active = await this.sessionRepo.listActiveByUser(user.id, now);
    return { ...user.toAdminView(now), activeSessions: active.length };
  }
}
