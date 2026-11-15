// =========================================================
// UC16 (#270) — store one in-app notification from a consumed event.
// Never throws: shared consume() nacks a throwing handler WITHOUT requeue, so throwing would not
// retry anything and would only stop the email that follows. A storage failure is logged and the
// email still goes out. A duplicate delivery (same sourceKey) is ignored by the repository.
// =========================================================
import { buildInAppNotification } from '../domain/in-app-notification.js';

/**
 * @param {{ repository: { createIfAbsent: (row: object) => Promise<boolean> }, logger?: Console }} deps
 * @returns {(event: string, payload: object) => Promise<{ stored?: true, skipped?: string, failed?: true }>}
 */
export function createStoreInAppNotification({ repository, logger = console }) {
  return async function storeInAppNotification(event, payload = {}) {
    let row;
    try {
      row = buildInAppNotification(event, payload);
    } catch (err) {
      logger.warn(`[notification] in-app ${event}: payload không đọc được (${err.message})`);
      return { skipped: 'bad_payload' };
    }
    if (!row) return { skipped: 'no_recipient' };
    try {
      const created = await repository.createIfAbsent(row);
      return created ? { stored: true } : { skipped: 'duplicate' };
    } catch (err) {
      logger.error(`[notification] in-app ${event} (tourId=${row.tourId}) lưu thất bại: ${err.message}`);
      return { failed: true };
    }
  };
}
