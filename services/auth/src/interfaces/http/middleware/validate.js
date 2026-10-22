// =========================================================
// Middleware validate body theo zod schema. Lỗi -> ValidationError (E1/E4).
// Gắn dữ liệu đã parse vào req.validated để controller dùng.
// =========================================================
import { ValidationError } from '../../../domain/errors/index.js';

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!details[key]) details[key] = issue.message;
      }
      const first = result.error.issues[0]?.message || 'Dữ liệu không hợp lệ';
      return next(new ValidationError(first, details));
    }
    req.validated = result.data;
    next();
  };
}
