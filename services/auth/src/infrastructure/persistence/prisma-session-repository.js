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

  async deleteEndedBefore(cutoff) {
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    return count;
  }
}
