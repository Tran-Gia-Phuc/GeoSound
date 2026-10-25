// =========================================================
// SimControls — công cụ GIẢ LẬP GPS để thử nghiệm UC04 không cần ra hiện trường
// (khớp quy ước GPS-sim phía client của dự án). Bật giả lập -> chạm bản đồ để
// đặt vị trí; "Đi theo route" tự di chuyển dọc đường để kích hoạt các vùng.
// =========================================================
import Icon from '../../components/Icon.jsx';

export default function SimControls({ simulate, onToggle, walking, onWalk, canWalk, open, onToggleOpen }) {
  return (
    <div className={`sim ${open ? 'sim--open' : ''}`}>
      <button className="iconbtn sim__fab" onClick={onToggleOpen} aria-expanded={open} aria-label="Công cụ giả lập GPS" title="Giả lập GPS (thử nghiệm)">
        <Icon name="crosshair" size={20} />
      </button>
      {open ? (
        <div className="sim__panel" role="group" aria-label="Giả lập GPS">
          <div className="sim__title">
            <Icon name="info" size={14} /> Giả lập GPS (thử nghiệm)
          </div>
          <label className="switch">
            <input type="checkbox" checked={simulate} onChange={(e) => onToggle(e.target.checked)} />
            <span className="switch__slider" />
            <span>Đặt vị trí bằng cách chạm bản đồ</span>
          </label>
          <button className="btn btn--block" onClick={onWalk} disabled={!canWalk}>
            <Icon name={walking ? 'pause' : 'navigation'} size={16} />
            {walking ? 'Dừng đi theo route' : 'Đi theo route'}
          </button>
          <p className="sim__hint">Dùng để kiểm thử auto-phát khi vào vùng kích hoạt. Tắt khi đi thực địa.</p>
        </div>
      ) : null}
    </div>
  );
}
