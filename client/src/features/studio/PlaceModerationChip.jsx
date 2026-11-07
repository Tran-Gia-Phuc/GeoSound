// =========================================================
// PlaceModerationChip (UC15 #137) — AI moderation state of one place (text + images):
// checking / approved / warning / rejected. The caller decides when to show 'approved'
// (only when the server runs in moderation mode: it is the default of every place).
// =========================================================
import Icon from '../../components/Icon.jsx';
import { placeModerationMeta } from '../../lib/submission.js';

/** @param {{ status?: string }} props */
export default function PlaceModerationChip({ status }) {
  const meta = placeModerationMeta(status);
  if (!meta) return null;
  return (
    <span className={`statuschip statuschip--${meta.tone} modchip`} data-moderation={status}>
      <Icon name={meta.icon} size={12} className={status === 'checking' ? 'spin' : ''} /> {meta.label}
    </span>
  );
}
