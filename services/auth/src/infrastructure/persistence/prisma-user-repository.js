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
        status: user.status,
        banReason: user.banReason,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil,
      },
    });
    return PrismaUserRepository.toEntity(row);
  }
}
