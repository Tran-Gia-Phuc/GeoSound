// =========================================================
// AdminInsightController (UC22 #275, UC21 #274 step 2) — thin: reads req.validated*, calls the use
// case, returns JSON. The router already checked role = admin. Read-only: the log has no write route.
// =========================================================

export class AdminInsightController {
  /** @param {{ getAdminDashboard, listAdminActions, getAdminAction, getUserViolations }} useCases */
  constructor(useCases) {
    this.uc = useCases;
    for (const m of ['dashboard', 'actions', 'action', 'violations']) {
      this[m] = this[m].bind(this);
    }
  }

  // Steps 1–2 / A1 — dashboard of a period (E1: zeros and empty lists)
  async dashboard(req, res) {
    res.json(await this.uc.getAdminDashboard.execute(req.validatedQuery ?? {}));
  }

  // Steps 3–5 / A2 — action log, filtered and paged
  async actions(req, res) {
    res.json(await this.uc.listAdminActions.execute(req.validatedQuery ?? {}));
  }

  // One log entry
  async action(req, res) {
    res.json(await this.uc.getAdminAction.execute({ id: req.validatedParams.id }));
  }

  // UC21 step 2 — violation history of one author
  async violations(req, res) {
    res.json(await this.uc.getUserViolations.execute({ userId: req.validatedParams.userId }));
  }
}
