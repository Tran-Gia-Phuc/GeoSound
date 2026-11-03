// =========================================================
// Entity: AdminAction (UC20 #273, decision L14) — one row of the append-only admin action log
// (table admin_actions), shared later with UC21 (account actions) and read by UC22.
// Pure domain: no Prisma / HTTP. A row is never changed or deleted once written.
// =========================================================
import { ValidationError } from '../errors/index.js';

export const ADMIN_ACTION = Object.freeze({
  HIDE_TOUR: 'hide_tour',
  RESTORE_TOUR: 'restore_tour',
  DISMISS_REPORTS: 'dismiss_reports',
});

export const ADMIN_TARGET = Object.freeze({ TOUR: 'tour', USER: 'user' });

const ACTIONS = new Set(Object.values(ADMIN_ACTION));
const TARGETS = new Set(Object.values(ADMIN_TARGET));

export const ADMIN_REASON_MAX = 1000;

/**
 * Checks an entry before it is appended (programming errors, not user input).
 * @param {{ adminId: string, action: string, targetType: string, targetId: string, reason?: string|null, data?: object }} entry
 */
export function assertAdminActionEntry(entry) {
  if (!entry?.adminId) throw new Error('admin action: adminId is required');
  if (!ACTIONS.has(entry.action)) throw new Error(`admin action: unknown action ${entry.action}`);
  if (!TARGETS.has(entry.targetType)) throw new Error(`admin action: unknown target type ${entry.targetType}`);
  if (!entry.targetId) throw new Error('admin action: targetId is required');
  return entry;
}

/**
 * Admin reason: trimmed, empty -> null, at most 1000 characters; `required` for a hide.
 * The HTTP edge (zod) applies the same rule; this keeps the use cases safe when called directly.
 */
export function normalizeAdminReason(reason, { required = false } = {}) {
  const text = reason === undefined || reason === null ? '' : String(reason).trim();
  if (!text) {
    if (required) {
      const err = new ValidationError('Vui lòng nhập lý do', { reason: 'Vui lòng nhập lý do' });
      err.status = 422;
      throw err;
    }
    return null;
  }
  if (text.length > ADMIN_REASON_MAX) {
    const err = new ValidationError('Lý do tối đa 1000 ký tự', { reason: 'Lý do tối đa 1000 ký tự' });
    err.status = 422;
    throw err;
  }
  return text;
}

export class AdminAction {
  /**
   * @param {{ id?: string, adminId: string, action: string, targetType: string, targetId: string,
   *           reason?: string|null, data?: object, createdAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.adminId = props.adminId;
    this.action = props.action;
    this.targetType = props.targetType;
    this.targetId = props.targetId;
    this.reason = props.reason ?? null;
    this.data = props.data ?? {};
    this.createdAt = props.createdAt ?? null;
    Object.freeze(this); // append-only: an entry is never edited
  }

  toPublic() {
    return {
      id: this.id,
      adminId: this.adminId,
      action: this.action,
      targetType: this.targetType,
      targetId: this.targetId,
      reason: this.reason,
      data: this.data,
      createdAt: this.createdAt,
    };
  }
}
