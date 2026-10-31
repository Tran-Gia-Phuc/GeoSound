// =========================================================
// Internal lookup (#258): contact data of one user for another service (Notification emails the
// contributor of a tour event that carries only contributorId). Never the hash, role or status.
// =========================================================
import { UserNotFoundError } from '../../domain/errors/index.js';

export class GetUserContact {
  /** @param {{ userRepo }} deps */
  constructor({ userRepo }) {
    this.userRepo = userRepo;
  }

  /** @param {{ userId: string }} input */
  async execute({ userId }) {
    const user = userId ? await this.userRepo.findById(String(userId)) : null;
    if (!user) throw new UserNotFoundError();
    return { id: user.id, email: user.email, fullName: user.fullName };
  }
}
