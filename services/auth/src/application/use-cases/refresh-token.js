// =========================================================
// UC01 (hỗ trợ) — Làm mới access token từ refresh token.
// =========================================================
import { InvalidTokenError, AccountBannedError } from '../../domain/errors/index.js';

export class RefreshToken {
  /** @param {{ userRepo, tokens }} deps */
  constructor({ userRepo, tokens }) {
    this.userRepo = userRepo;
    this.tokens = tokens;
  }

  /** @param {{ refreshToken: string }} input */
  async execute({ refreshToken }) {
    let decoded;
    try {
      decoded = this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new InvalidTokenError();
    }

    const user = await this.userRepo.findById(decoded.sub);
    if (!user) throw new InvalidTokenError();
    if (user.isBanned()) throw new AccountBannedError(user.banReason);

    const tokens = this.tokens.issueTokens(user);
    return { user: user.toPublic(), ...tokens };
  }
}
