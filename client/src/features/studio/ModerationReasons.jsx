// =========================================================
// ModerationReasons (UC15 #111, #112, #137) — list of AI / geo moderation reasons:
// field, category (Vietnamese), message, source (AI / Kiểm tra vị trí). A geo reason that
// names a place ("(placeId X)") shows the place name with a link to edit it.
// =========================================================
import { Link } from 'react-router-dom';
import { categoryLabel, fieldLabel, sourceLabel, splitPlaceRef } from '../../lib/submission.js';

/**
 * @param {{ reasons: Array<{ field?, category?, message?, source?, severity? }>,
 *           places?: Array<{ id, name }>, tourId?: string, label?: string }} props
 */
export default function ModerationReasons({ reasons, places = [], tourId, label = 'Lý do kiểm duyệt' }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  const byId = new Map((places || []).map((p) => [p.id, p]));
  return (
    <ul className="modreasons" aria-label={label}>
      {reasons.map((r, i) => {
        const { text, placeId } = splitPlaceRef(r.message);
        const place = placeId ? byId.get(placeId) : null;
        const source = r.source === 'geo' ? 'geo' : 'ai';
        return (
          <li key={`${r.field}-${i}`} className="modreasons__item">
            <div className="modreasons__meta">
              <span className="modreasons__field">{fieldLabel(r.field)}</span>
              <span className="chip modreasons__cat">{categoryLabel(r.category)}</span>
              <span className={`modreasons__src modreasons__src--${source}`}>{sourceLabel(source)}</span>
            </div>
            <p className="modreasons__msg">{text || 'Không có mô tả chi tiết.'}</p>
            {placeId ? (
              <p className="modreasons__place small">
                Điểm dừng: <b>{place?.name ?? 'không còn trong tour'}</b>
                {place && tourId ? (
                  <>
                    {' · '}
                    <Link className="linkbtn" to={`/studio/tours/${tourId}/places?edit=${encodeURIComponent(place.id)}`}>
                      Sửa điểm này
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
