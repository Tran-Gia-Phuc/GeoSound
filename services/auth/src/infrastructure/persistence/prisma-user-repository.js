// =========================================================
// Impl của port UserRepository bằng Prisma. Map DB row <-> entity User.
// =========================================================
import { User } from '../../domain/entities/user.js';

/** @implements {import('../../domain/ports/index.js').UserRepository} */
export class PrismaUserRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  /** Prisma row -> entity. */
  static toEntity(row) {
    if (!row) return null;
    return new User({
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      fullName: row.fullName,
      role: row.role,
      status: row.status,
      banReason: row.banReason,
      suspendedUntil: row.suspendedUntil ?? null,
      failedAttempts: row.failedAttempts,
      lockedUntil: row.lockedUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async findByEmail(email) {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return PrismaUserRepository.toEntity(row);
  }

  async findById(id) {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return PrismaUserRepository.toEntity(row);
  }

  async create(user) {
    const row = await this.prisma.user.create({
      data: {
        email: user.email,
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        role: user.role,
      },
    });
    return PrismaUserRepository.toEntity(row);
  }

  async save(user) {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        role: user.role,
        // UC21: status, banReason and suspendedUntil are written only by updateStatusIf (conditional),
        // so a sign-in that saves its lockout counter can never undo a ban made at the same moment.
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil,
      },
    });
    return PrismaUserRepository.toEntity(row);
  }

  /**
   * UC21 — admin search. `status` filters on the effective status: a suspension whose end passed
   * counts as active.
   * @param {{ q?: string, role?: string, status?: string, skip: number, take: number, now: Date }} input
   */
  async search({ q, role, status, skip, take, now }) {
    const and = [];
    if (q) {
      and.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (role) and.push({ role });
    if (status === 'banned') and.push({ status: 'banned' });
    if (status === 'suspended') {
      and.push({ status: 'suspended', OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }] });
    }
    if (status === 'active') {
      and.push({ OR: [{ status: 'active' }, { status: 'suspended', suspendedUntil: { lte: now } }] });
    }
    const where = and.length ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(PrismaUserRepository.toEntity), total };
  }

  /**
   * UC21 — conditional status write: applies `next` only while the row still has the `expected`
   * status and suspension end, so of two admins acting at once only one wins.
   * @param {string} id
   * @param {{ status: string, suspendedUntil: Date|null }} expected
   * @param {{ status: string, banReason: string|null, suspendedUntil: Date|null }} next
   * @returns {Promise<boolean>} false when the state moved in between
   */
  async updateStatusIf(id, expected, next) {
    const { count } = await this.prisma.user.updateMany({
      where: { id, status: expected.status, suspendedUntil: expected.suspendedUntil ?? null },
      data: { status: next.status, banReason: next.banReason, suspendedUntil: next.suspendedUntil },
    });
    return count === 1;
  }
}
