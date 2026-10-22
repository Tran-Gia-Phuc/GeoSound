// =========================================================
// Middleware validate body/params theo zod schema. Lỗi -> ValidationError (E2/E3).
// Gắn dữ liệu đã parse vào req.validated / req.validatedParams cho controller.
// =========================================================
import { ValidationError } from '../../../domain/errors/index.js';

function collect(error) {
  const details = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  const first = error.issues[0]?.message || 'Dữ liệu không hợp lệ';
  return { first, details };
}

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const { first, details } = collect(result.error);
      return next(new ValidationError(first, details));
    }
    req.validated = result.data;
    next();
  };
}

export function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) {
      const { first, details } = collect(result.error);
      return next(new ValidationError(first, details));
    }
    req.validatedParams = result.data;
    next();
  };
}
