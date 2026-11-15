// =========================================================
// UC17 (#271) — optional sign-in for public beacons. Without a Bearer token the request goes on
// anonymously. With one, the injected guard (shared verifyJwt(), any role) checks it: valid -> req.user
// is set; invalid, expired or signed out -> the request still goes on anonymously (no 401), so an
// expired access token never loses a count (the body's deviceId is used instead).
// No ../shared import here (CI repo layout): the guard is passed in.
// =========================================================

/** @param {import('express').RequestHandler} verify @returns {import('express').RequestHandler} */
export function optionalAuth(verify) {
  if (typeof verify !== 'function') throw new Error('optionalAuth: verify is required');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return next();
    let done = false;
    const once = (fn) => (...args) => {
      if (done) return undefined;
      done = true;
      return fn(...args);
    };
    const anonymous = once(() => {
      delete req.user;
      next();
    });
    // The guard answers a rejection with res.status(...).json(...): turn that into "anonymous".
    const shim = { status: () => ({ json: anonymous, end: anonymous, send: anonymous }) };
    verify(req, shim, once(next));
  };
}
