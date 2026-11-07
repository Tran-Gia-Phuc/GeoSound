// =========================================================
// UC18 — public author page and follow (docs/02-design/uc18-author-page.md).
//   GetAuthorProfile  public page of an active contributor (never the email)
//   GetFollowState    am I following this author, and how many followers
//   FollowAuthor      idempotent; not yourself (R4); only active contributors (R3)
//   UnfollowAuthor    idempotent; always allowed, so a stale follow can be removed
//   ListFollowing     authors I follow, newest follow first, paged
//   GetMyProfile      #298: id, email, fullName, role, bio, avatarUrl of the signed-in account (any role)
//   UpdateMyProfile   A1: fullName, bio, avatarUrl of the signed-in account (any role)
// Ports injected: userRepo (UserRepository), followRepo (FollowRepository).
// =========================================================
import { AuthorNotFoundError, SelfFollowError, UserNotFoundError, ValidationError } from '../../domain/errors/index.js';
import { isValidAvatarUrl } from '../../domain/value-objects/avatar-url.js';

export const FOLLOWING_DEFAULT_LIMIT = 20;
export const FOLLOWING_MAX_LIMIT = 50;
export const BIO_MAX = 500;
export const FULL_NAME_MAX = 120;

/** Loads an author with a public page or throws 404 author_not_found (unknown, not a contributor, restricted). */
async function loadAuthor(userRepo, authorId, now) {
  const author = authorId ? await userRepo.findById(String(authorId)) : null;
  if (!author || !author.isFollowableAuthor(now)) throw new AuthorNotFoundError();
  return author;
}

class AuthorUseCase {
  /** @param {{ userRepo, followRepo, now?: () => Date }} deps */
  constructor({ userRepo, followRepo, now }) {
    this.userRepo = userRepo;
    this.followRepo = followRepo;
    this.now = now ?? (() => new Date());
  }
}

export class GetAuthorProfile extends AuthorUseCase {
  /** @param {{ authorId: string }} input */
  async execute({ authorId }) {
    const author = await loadAuthor(this.userRepo, authorId, this.now());
    return author.toAuthorProfile(await this.followRepo.countFollowers(author.id));
  }
}

export class GetFollowState extends AuthorUseCase {
  /** @param {{ userId: string, authorId: string }} input */
  async execute({ userId, authorId }) {
    const author = await loadAuthor(this.userRepo, authorId, this.now());
    const [following, followerCount] = await Promise.all([
      userId === author.id ? false : this.followRepo.isFollowing(userId, author.id),
      this.followRepo.countFollowers(author.id),
    ]);
    return { following, followerCount };
  }
}

export class FollowAuthor extends AuthorUseCase {
  /** @param {{ userId: string, authorId: string }} input */
  async execute({ userId, authorId }) {
    if (String(authorId) === String(userId)) throw new SelfFollowError(); // R4
    const author = await loadAuthor(this.userRepo, authorId, this.now()); // R3
    await this.followRepo.follow(userId, author.id); // R5: the unique pair makes it idempotent
    return { following: true, followerCount: await this.followRepo.countFollowers(author.id) };
  }
}

export class UnfollowAuthor extends AuthorUseCase {
  /** @param {{ userId: string, authorId: string }} input */
  async execute({ userId, authorId }) {
    const id = String(authorId ?? '');
    await this.followRepo.unfollow(userId, id); // R5: removing an absent row is a no-op
    return { following: false, followerCount: await this.followRepo.countFollowers(id) };
  }
}

export class ListFollowing extends AuthorUseCase {
  /** @param {{ userId: string, page?: number, limit?: number }} input */
  async execute({ userId, page = 1, limit = FOLLOWING_DEFAULT_LIMIT }) {
    const take = Math.min(Math.max(Math.trunc(limit) || FOLLOWING_DEFAULT_LIMIT, 1), FOLLOWING_MAX_LIMIT);
    const current = Math.max(Math.trunc(page) || 1, 1);
    const { items, total } = await this.followRepo.listFollowing({
      followerId: userId,
      skip: (current - 1) * take,
      take,
      now: this.now(),
    });
    const counts = await this.followRepo.countFollowersMany(items.map((i) => i.author.id));
    return {
      items: items.map((i) => ({ ...i.author.toAuthorProfile(counts.get(i.author.id) ?? 0), followedAt: i.followedAt })),
      total,
      page: current,
      limit: take,
    };
  }
}

export class UpdateMyProfile extends AuthorUseCase {
  /**
   * Input is already shaped by the zod schema (trimmed, blank bio / avatar = null); the rules are
   * checked again here so the use case is safe on its own.
   * @param {{ userId: string, fullName?: string, bio?: string|null, avatarUrl?: string|null }} input
   */
  async execute({ userId, fullName, bio, avatarUrl }) {
    const fields = {};
    if (fullName !== undefined) {
      const name = String(fullName).trim();
      if (!name || name.length > FULL_NAME_MAX) throw new ValidationError('Họ tên từ 1 đến 120 ký tự', { fullName: 'invalid' });
      fields.fullName = name;
    }
    if (bio !== undefined) {
      const text = bio === null ? '' : String(bio).trim();
      if (text.length > BIO_MAX) throw new ValidationError('Giới thiệu tối đa 500 ký tự', { bio: 'too_long' });
      fields.bio = text || null;
    }
    if (avatarUrl !== undefined) {
      const url = avatarUrl === null ? '' : String(avatarUrl).trim();
      if (url && !isValidAvatarUrl(url)) throw new ValidationError('Ảnh đại diện không hợp lệ', { avatarUrl: 'invalid' });
      fields.avatarUrl = url || null;
    }
    if (!Object.keys(fields).length) throw new ValidationError('Không có thông tin nào để cập nhật');

    const user = await this.userRepo.updateProfile(String(userId), fields);
    if (!user) throw new UserNotFoundError();
    const followerCount = await this.followRepo.countFollowers(user.id);
    return { ...user.toAuthorProfile(followerCount), email: user.email, role: user.role };
  }
}

export class GetMyProfile extends AuthorUseCase {
  /**
   * #298: the signed-in account's own profile for the editor (any role, any status: the caller
   * holds a valid token). 404 user_not_found when the account is gone.
   * @param {{ userId: string }} input
   */
  async execute({ userId }) {
    const user = userId ? await this.userRepo.findById(String(userId)) : null;
    if (!user) throw new UserNotFoundError();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      bio: user.bio ?? null,
      avatarUrl: user.avatarUrl ?? null,
    };
  }
}
