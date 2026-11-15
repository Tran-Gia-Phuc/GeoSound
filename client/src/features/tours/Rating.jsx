// Điểm đánh giá gọn: ★ 4,8 (123). Chưa có đánh giá -> nhãn mờ.
import Icon from '../../components/Icon.jsx';

export default function Rating({ value, count, className = '' }) {
  if (!count) return <span className={`muted small ${className}`}>Chưa có đánh giá</span>;
  const v = Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '—';
  return (
    <span className={`rating ${className}`}>
      <Icon name="star" size={14} className="rating__star" />
      <b>{v}</b>
      <span className="muted small">({count})</span>
    </span>
  );
}
