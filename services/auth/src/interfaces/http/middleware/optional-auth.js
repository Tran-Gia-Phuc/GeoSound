// =========================================================
// #329 — optional sign-in for the presence beat. Without a Bearer token the request goes on as a
// guest. With one, the injected guard (shared verifyJwt(), any role) decides: an invalid, expired
// or signed-out token gets its 401, so the client refreshes as for any signed-in call and the
// session keeps being touched. (Tour's optionalAuth, UC17, turns a bad token into a guest instead:
// a statistics beacon must never be lost.) No ../shared import here (CI repo layout).
// =========================================================

/** @param {import('express').RequestHandler} verify @returns {import('express').RequestHandler} */
export function optionalAuth(verify) {
  if (typeof verify !== 'function') throw new Error('optionalAuth: verify is required');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? verify(req, res, next) : next();
  };
}
