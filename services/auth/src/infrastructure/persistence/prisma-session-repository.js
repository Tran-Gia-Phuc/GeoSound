// =========================================================
// UC23 — impl of the SessionRepository port with Prisma (table auth.sessions).
// Map DB row <-> entity Session.
// =========================================================
import { Session } from '../../domain/entities/session.js';

/** @implements {import('../../domain/ports/index.js').SessionRepository} */
export class PrismaSessionRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    return row ? new Session(row) : null;
  }

  static toData(s) {
    return {
      userId: s.userId,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      location: s.location,
      refreshHash: s.refreshHash,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      revokeReason: s.revokeReason,
    };
  }

  async create(session) {
    const row = await this.prisma.session.create({
      data: { id: session.id, ...PrismaSessionRepository.toData(session) },
    });
    return PrismaSessionRepository.toEntity(row);
  }

  async save(session) {
    const row = await this.prisma.session.update({
      where: { id: session.id },
      data: PrismaSessionRepository.toData(session),
    });
    return PrismaSessionRepository.toEntity(row);
  }

  async findById(id) {
    const row = await this.prisma.session.findUnique({ where: { id: String(id) } });
    return PrismaSessionRepository.toEntity(row);
  }

  async findLatestByDevice(userId, deviceId) {
    const row = await this.prisma.session.findFirst({
      where: { userId, deviceId },
      orderBy: { createdAt: 'desc' },
    });
    return PrismaSessionRepository.toEntity(row);
  }

  async listActiveByUser(userId, now) {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return rows.map(PrismaSessionRepository.toEntity);
  }

  // #265 — heartbeat: one conditional write, skipped when the session is ended or was touched recently.
  async touch(id, now, notAfter) {
    const { count } = await this.prisma.session.updateMany({
      where: { id: String(id), revokedAt: null, expiresAt: { gt: now }, lastActiveAt: { lt: notAfter } },
      data: { lastActiveAt: now },
    });
    return count > 0;
  }

  // #265 — admin counts over the table (only rows kept by the retention job, R12).
  async countStats(now, onlineSince) {
    const active = { revokedAt: null, expiresAt: { gt: now } };
    const online = { ...active, lastActiveAt: { gte: onlineSince } };
    const [devices, signedIn, onlineCount, onlineUsers] = await Promise.all([
      this.prisma.session.findMany({ distinct: ['userId', 'deviceId'], select: { deviceId: true } }),
      this.prisma.session.count({ where: active }),
      this.prisma.session.count({ where: online }),
      this.prisma.session.findMany({ where: online, distinct: ['userId'], select: { userId: true } }),
    ]);
    // Rows without deviceId (old clients) are grouped per user by `distinct`: count them per row instead.
    const withoutDevice = await this.prisma.session.count({ where: { deviceId: null } });
    const devicesSeen = devices.filter((d) => d.deviceId !== null).length + withoutDevice;
    return { devicesSeen, signedIn, online: onlineCount, onlineAccounts: onlineUsers.length };
  }

  // #265 — online sessions with their account, most recently active first.
  async listOnline(now, onlineSince, limit) {
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now }, lastActiveAt: { gte: onlineSince } },
      orderBy: { lastActiveAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
    });
    return rows.map((row) => ({ session: PrismaSessionRepository.toEntity(row), user: row.user }));
  }

  // #329 — device ids of the online sessions, to tell signed-in devices from guests.
  async listOnlineDeviceIds(now, onlineSince) {
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now }, lastActiveAt: { gte: onlineSince } },
      select: { deviceId: true },
    });
    return rows.map((row) => row.deviceId);
  }

  async deleteEndedBefore(cutoff) {
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    return count;
  }
}
