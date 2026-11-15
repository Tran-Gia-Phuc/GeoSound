// =========================================================
// UC18 — author page, follow and own profile. Thin: validated input -> use case -> JSON.
// The signed-in user is req.user.sub (shared verifyJwt); the author page itself is public.
// =========================================================

export class AuthorController {
  /** @param {{ getAuthorProfile, getFollowState, followAuthor, unfollowAuthor, listFollowing, getMyProfile, updateMyProfile }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['profile', 'followState', 'follow', 'unfollow', 'following', 'myProfile', 'updateProfile']) {
      this[m] = this[m].bind(this);
    }
  }

  async profile(req, res) {
    res.json(await this.uc.getAuthorProfile.execute({ authorId: req.params.id }));
  }

  async followState(req, res) {
    res.json(await this.uc.getFollowState.execute({ userId: req.user?.sub, authorId: req.params.id }));
  }

  async follow(req, res) {
    res.json(await this.uc.followAuthor.execute({ userId: req.user?.sub, authorId: req.params.id }));
  }

  async unfollow(req, res) {
    res.json(await this.uc.unfollowAuthor.execute({ userId: req.user?.sub, authorId: req.params.id }));
  }

  async following(req, res) {
    res.json(await this.uc.listFollowing.execute({ userId: req.user?.sub, ...(req.validatedQuery ?? {}) }));
  }

  async myProfile(req, res) {
    res.json(await this.uc.getMyProfile.execute({ userId: req.user?.sub }));
  }

  async updateProfile(req, res) {
    res.json(await this.uc.updateMyProfile.execute({ userId: req.user?.sub, ...req.validated }));
  }
}
