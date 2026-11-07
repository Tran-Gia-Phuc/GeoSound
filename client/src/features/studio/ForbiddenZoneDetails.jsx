// =========================================================
// ForbiddenZoneDetails (UC15 #113, UC10 E2) — details of a 422 `forbidden_zone` error:
// the zone name and type the server returned, and what the author has to do.
// =========================================================
import Icon from '../../components/Icon.jsx';
import { zoneTypeLabel } from '../../lib/submission.js';

/** @param {{ zone?: { name?: string|null, type?: string|null }, placeName?: string, onMap?: boolean }} props */
export default function ForbiddenZoneDetails({ zone, placeName, onMap = false }) {
  return (
    <div className="alert alert--warn forbidden-zone" role="alert" aria-label="Vị trí nằm trong vùng cấm">
      <Icon name="alert-triangle" size={18} className="alert__icon" />
      <div>
        <b>{placeName ? `Điểm “${placeName}” nằm trong vùng cấm` : 'Vị trí nằm trong vùng cấm'}</b>
        <dl className="forbidden-zone__list">
          <dt>Vùng cấm</dt>
          <dd>{zone?.name || 'Không rõ tên'}</dd>
          <dt>Loại</dt>
          <dd>{zoneTypeLabel(zone?.type)}</dd>
        </dl>
        <p className="small">
          {onMap
            ? 'Vùng cấm được tô đỏ trên bản đồ. Kéo ghim ra ngoài vùng này rồi lưu lại.'
            : 'Hãy dời điểm dừng ra ngoài vùng này rồi lưu lại.'}
        </p>
      </div>
    </div>
  );
}
