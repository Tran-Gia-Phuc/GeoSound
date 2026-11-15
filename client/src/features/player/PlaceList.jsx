// =========================================================
// PlaceList — danh sách điểm dừng (UC04 A5 nghe thử & chọn thủ công A3).
// Chạm một điểm -> phát ngay, không cần GPS. Hiện trạng thái đã nghe / đang phát.
// =========================================================
import Icon from '../../components/Icon.jsx';

export default function PlaceList({ places, currentPlaceId, visitedIds, onSelect }) {
  const visited = visitedIds instanceof Set ? visitedIds : new Set(visitedIds || []);
  return (
    <ul className="stops" aria-label="Danh sách điểm dừng">
      {places.map((p, i) => {
        const active = p.id === currentPlaceId;
        const done = visited.has(p.id);
        return (
          <li key={p.id}>
            <button
              className={`stop ${active ? 'stop--active' : ''}`}
              onClick={() => onSelect?.(p.id)}
              aria-current={active ? 'true' : undefined}
            >
              <span className={`stop__num ${done ? 'stop__num--done' : ''}`}>
                {done ? <Icon name="check-circle" size={18} /> : i + 1}
              </span>
              <span className="stop__info">
                <span className="stop__name">{p.name}</span>
                <span className="stop__sub">
                  {active ? 'Đang phát' : done ? 'Đã nghe' : p.text ? `${Math.max(1, Math.round(p.text.length / 180))} phút đọc` : 'Điểm dừng'}
                </span>
              </span>
              <span className="stop__icon">
                <Icon name={active ? 'volume' : 'play'} size={18} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
