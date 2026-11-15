// Impl của port PasswordHasher bằng bcryptjs.
import bcrypt from 'bcryptjs';

/** @implements {import('../../domain/ports/index.js').PasswordHasher} */
export class BcryptHasher {
  /** @param {number} rounds */
  constructor(rounds = 10) {
    this.rounds = rounds;
  }

  hash(plain) {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain, hash) {
    return bcrypt.compare(plain, hash);
  }
}
