// =========================================================
// Middleware validate body theo zod schema. Lỗi -> ValidationError (E1/E4).
// Gắn dữ liệu đã parse vào req.validated để controller dùng.
// UC21: `status` overrides the default 400 (422 for the admin action bodies, like UC19);
// validateQuery puts the parsed query on req.validatedQuery.
// =========================================================
import { ValidationError } from '../../../domain/errors/index.js';

function toError(error, status) {
  const details = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  const first = error.issues[0]?.message || 'Dữ liệu không hợp lệ';
  const err = new ValidationError(first, details);
  if (status) err.status = status;
  return err;
}

export function validateBody(schema, { status } = {}) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(toError(result.error, status));
    req.validated = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return next(toError(result.error));
    req.validatedQuery = result.data;
    next();
  };
}
