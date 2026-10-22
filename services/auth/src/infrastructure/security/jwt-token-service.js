// =========================================================
// Impl của port TokenService bằng jsonwebtoken.
// Access token mang {sub, email, role}; refresh token chỉ mang {sub}.
// Secret/TTL lấy từ env (khớp shared/middleware verifyJwt).
// =========================================================
import jwt from 'jsonwebtoken';

/** @implements {import('../../domain/ports/index.js').TokenService} */
export class JwtTokenService {
  /**
   * @param {{ accessSecret: string, refreshSecret: string, accessTtl: string, refreshTtl: string }} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
  }

  issueTokens(user) {
    const payload = user.toAuthPayload();
    const accessToken = jwt.sign(payload, this.cfg.accessSecret, { expiresIn: this.cfg.accessTtl });
    const refreshToken = jwt.sign({ sub: payload.sub }, this.cfg.refreshSecret, {
      expiresIn: this.cfg.refreshTtl,
    });
    return { accessToken, refreshToken, expiresIn: this.cfg.accessTtl };
  }

  verifyRefresh(refreshToken) {
    const decoded = jwt.verify(refreshToken, this.cfg.refreshSecret);
    return { sub: decoded.sub };
  }
}
