// =========================================================
// Internal routes (#258), for other services inside the Docker network only.
//   GET /internal/users/:id/contact -> { id, email, fullName }   (Notification)
// =========================================================
import { Router } from 'express';
import { requireInternalToken } from '../middleware/internal-token.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ getUserContact, internalToken?: string|null }} deps */
export function buildInternalRouter({ getUserContact, internalToken }) {
  const r = Router();
  r.use(requireInternalToken(internalToken));
  r.get(
    '/users/:id/contact',
    wrap(async (req, res) => {
      res.json(await getUserContact.execute({ userId: req.params.id }));
    }),
  );
  return r;
}
