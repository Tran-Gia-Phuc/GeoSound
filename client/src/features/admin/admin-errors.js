// Error text shared by the admin screens (Vietnamese backend messages are shown as they are).
import { ADMIN_ONLY_MESSAGE } from './AdminGate.jsx';

export const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';

export function adminErrorMessage(err, fallback) {
  if (err?.offline) return OFFLINE_MESSAGE;
  if (err?.status === 403) return ADMIN_ONLY_MESSAGE;
  return err?.message || fallback;
}
