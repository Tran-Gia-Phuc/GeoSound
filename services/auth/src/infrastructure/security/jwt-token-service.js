// =========================================================
// Impl của port TokenService bằng jsonwebtoken.
// Access token mang {sub, email, role}; refresh token chỉ mang {sub}.
// UC23: with a session id, the access token also carries `sid` and the refresh token
// carries {sub, sid, jti} (random jti: two refresh tokens of one session never collide).
// Secret/TTL lấy từ env (khớp shared/middleware verifyJwt).
// =========================================================
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

/** @implements {import('../../domain/ports/index.js').TokenService} */
export class JwtTokenService {
  /**
   * @param {{ accessSecret: string, refreshSecret: string, accessTtl: string, refreshTtl: string }} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
  }

  /** @param {{ sid?: string }} [opts] */
  issueTokens(user, { sid } = {}) {
    const payload = user.toAuthPayload();
    const access = sid ? { ...payload, sid } : payload;
    const refresh = sid ? { sub: payload.sub, sid, jti: randomUUID() } : { sub: payload.sub };
    const accessToken = jwt.sign(access, this.cfg.accessSecret, { expiresIn: this.cfg.accessTtl });
    const refreshToken = jwt.sign(refresh, this.cfg.refreshSecret, { expiresIn: this.cfg.refreshTtl });
    return { accessToken, refreshToken, expiresIn: this.cfg.accessTtl };
  }

  verifyRefresh(refreshToken) {
    const decoded = jwt.verify(refreshToken, this.cfg.refreshSecret);
    return decoded.sid ? { sub: decoded.sub, sid: decoded.sid } : { sub: decoded.sub };
  }

  /** sha-256 hex of a refresh token: only the hash is stored in the session (R11). */
  hashRefresh(refreshToken) {
    return createHash('sha256').update(String(refreshToken)).digest('hex');
  }
}
