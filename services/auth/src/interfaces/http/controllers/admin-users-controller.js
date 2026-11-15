// =========================================================
// UC21 — admin account actions (routes /admin/users, role admin only). Thin: validated input ->
// use case -> JSON. The acting admin is req.user.sub (shared verifyJwt).
// =========================================================

export class AdminUsersController {
  /** @param {{ searchUsers, getUserForAdmin, warnUser, suspendUser, banUser, restoreUser }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['search', 'detail', 'warn', 'suspend', 'ban', 'restore']) this[m] = this[m].bind(this);
  }

  #action(req) {
    return { userId: req.params.id, adminId: req.user?.sub, ...req.validated };
  }

  async search(req, res) {
    res.json(await this.uc.searchUsers.execute(req.validatedQuery ?? {}));
  }

  async detail(req, res) {
    res.json(await this.uc.getUserForAdmin.execute({ userId: req.params.id }));
  }

  async warn(req, res) {
    const result = await this.uc.warnUser.execute(this.#action(req));
    res.json({ message: 'Đã gửi cảnh báo tới tài khoản', ...result });
  }

  async suspend(req, res) {
    const result = await this.uc.suspendUser.execute(this.#action(req));
    res.json({ message: 'Đã tạm khoá tài khoản', ...result });
  }

  async ban(req, res) {
    const result = await this.uc.banUser.execute(this.#action(req));
    res.json({ message: 'Đã cấm tài khoản', ...result });
  }

  async restore(req, res) {
    const result = await this.uc.restoreUser.execute(this.#action(req));
    res.json({ message: 'Đã khôi phục tài khoản', ...result });
  }
}
