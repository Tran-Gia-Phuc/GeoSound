// =========================================================
// SimBar — thanh mô phỏng di chuyển, HIỆN SẴN khi tác giả xem thử tour (UC13):
//   [▶ Đi bộ mô phỏng] [Chậm | Vừa | Nhanh]  · chạm bản đồ để dịch chuyển
// Dùng để kiểm audio có tự phát khi vào vùng kích hoạt mà không cần ra hiện trường.
// (Khách không thấy; ?debug=1 vẫn có công cụ nhỏ SimControls.)
// =========================================================
import Icon from '../../components/Icon.jsx';

// Mỗi bước mô phỏng ~14 m (densifyPath) — nhịp giữa hai bước theo tốc độ.
export const SIM_SPEEDS = {
  slow: { label: 'Chậm', stepMs: 700 },
  normal: { label: 'Vừa', stepMs: 320 },
  fast: { label: 'Nhanh', stepMs: 120 },
};

export default function SimBar({ walking, onWalk, canWalk, speed, onSpeed }) {
  return (
    <div className="simbar" role="group" aria-label="Mô phỏng di chuyển">
      <button className="btn btn--primary btn--sm simbar__walk" onClick={onWalk} disabled={!canWalk}>
        <Icon name={walking ? 'pause' : 'play'} size={16} />
        {walking ? 'Dừng' : 'Đi bộ mô phỏng'}
      </button>
      <div className="segmented simbar__speed" role="radiogroup" aria-label="Tốc độ">
        {Object.entries(SIM_SPEEDS).map(([key, s]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={speed === key}
            className={`segmented__item ${speed === key ? 'is-active' : ''}`}
            onClick={() => onSpeed(key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <span className="simbar__hint muted small">
        <Icon name="crosshair" size={13} /> Chạm bản đồ để dịch chuyển
      </span>
    </div>
  );
}
