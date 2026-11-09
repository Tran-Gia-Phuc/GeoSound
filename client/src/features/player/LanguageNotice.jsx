// =========================================================
// LanguageNotice (UC04 / UC12) — never fall back to the source language silently.
//   1. The language asked for is not served (tour.fallbackReason): say why, and offer the
//      automatic translation when the page can ask for it.
//   2. Otherwise the device language differs from the one playing: suggest it (already in the
//      tour) or offer its automatic translation. "Để sau" hides it for this tour on this device.
// Nothing is translated without the tourist's tap (the AI quota is shared).
// =========================================================
import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { langLabel } from '../../lib/format.js';
import { deviceLanguage, fallbackText, isOfferDismissed, dismissOffer } from '../../lib/languages.js';

/**
 * @param {{ tour: object, canTranslate: boolean, busy?: boolean, error?: string|null,
 *           onSwitch: (code: string) => void, onTranslate: (code: string) => void,
 *           className?: string, suggestDevice?: boolean }} props
 *   suggestDevice=false: only the fallback reason and the error (player banner).
 */
export default function LanguageNotice({ tour, canTranslate, busy = false, error = null, onSwitch, onTranslate, className = '', suggestDevice = true }) {
  const [dismissed, setDismissed] = useState(null);
  if (!tour) return null;
  const selected = tour.selectedLanguage;
  const available = tour.availableLanguages ?? [];
  const translatable = canTranslate ? tour.translatableLanguages ?? [] : [];

  let text = null;
  let action = null; // { label, run }
  let code = null;
  const reason = fallbackText(tour, canTranslate);
  if (reason) {
    text = reason;
    code = tour.requestedLanguage;
    if (tour.fallbackReason === 'not_translated' && translatable.includes(code)) {
      action = { label: `Dịch sang ${langLabel(code)}`, run: () => onTranslate(code) };
    }
  } else if (suggestDevice) {
    const device = deviceLanguage();
    if (device && device !== selected && dismissed !== device && !isOfferDismissed(tour.id, device)) {
      code = device;
      if (available.includes(device)) {
        text = `Tour có bản ${langLabel(device)}.`;
        action = { label: `Nghe bằng ${langLabel(device)}`, run: () => onSwitch(device) };
      } else if (translatable.includes(device)) {
        text = `Tour chưa có bản ${langLabel(device)}. Bạn có thể yêu cầu dịch tự động (bản dịch máy, tác giả chưa kiểm tra).`;
        action = { label: `Dịch sang ${langLabel(device)}`, run: () => onTranslate(device) };
      }
    }
  }
  if (!text && !error) return null;

  const later = () => {
    if (!reason && code) dismissOffer(tour.id, code);
    setDismissed(code);
  };

  return (
    <div className={`alert langnotice ${className}`} role="status" aria-live="polite">
      <Icon name="languages" size={18} />
      <div className="langnotice__body">
        {text ? <div>{text}</div> : null}
        {error ? <div className="langnotice__error">{error}</div> : null}
        {action || (!reason && code) ? (
          <div className="langnotice__actions">
            {action ? (
              <button className="btn btn--primary btn--sm" onClick={action.run} disabled={busy}>
                {busy ? <Icon name="loader" size={14} className="spin" /> : null}
                {busy ? 'Đang dịch…' : action.label}
              </button>
            ) : null}
            {!reason && code ? (
              <button className="btn btn--ghost btn--sm" onClick={later} disabled={busy}>Để sau</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
