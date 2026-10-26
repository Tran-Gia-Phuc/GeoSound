// =========================================================
// PlaceSheet — bottom sheet nội dung điểm (UC04 bước 8): text + ảnh.
// Text dài -> cắt gọn kèm nút "Xem thêm" (UX truncation). Kéo tay cầm để mở/thu.
// =========================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';

// API trả ảnh dạng { url, caption }; bản cũ/lịch trình có thể là chuỗi URL.
const toImage = (img) => (typeof img === 'string' ? { url: img, caption: '' } : img);

export default function PlaceSheet({ place, number, role, expanded, onToggle, audioError, editHref }) {
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    setShowAll(false);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [place?.id]);

  if (!place) {
    return (
      <div className="sheet sheet--empty">
        <button className="sheet__handle" onClick={onToggle} aria-label="Mở bảng nội dung">
          <span />
        </button>
        <div className="sheet__placeholder">
          <Icon name="headphones" size={28} />
          <p>Chọn một điểm trên bản đồ hoặc bắt đầu đi tour để nghe thuyết minh.</p>
        </div>
      </div>
    );
  }

  const images = Array.isArray(place.images) ? place.images.filter(Boolean).map(toImage).filter((im) => im.url) : [];

  return (
    <div className={`sheet ${expanded ? 'sheet--open' : ''}`} role="region" aria-label={`Nội dung điểm ${place.name}`}>
      <button
        className="sheet__handle"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Thu gọn nội dung' : 'Mở rộng nội dung'}
      >
        <span />
      </button>

      <div className="sheet__head">
        <div>
          <div className="sheet__eyebrow">
            {role === 'hint' ? 'Gợi ý đi tiếp' : role === 'nav' ? 'Chỉ đường' : number ? `Điểm ${number}` : 'Điểm dừng'}
          </div>
          <h2 className="sheet__title">{place.name}</h2>
        </div>
        <div className="sheet__headactions">
          {editHref ? (
            <Link className="btn btn--sm btn--ghost" to={editHref}>
              <Icon name="edit" size={14} /> Sửa điểm này
            </Link>
          ) : null}
          <button className="iconbtn" onClick={onToggle} aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}>
            <Icon name={expanded ? 'chevron-down' : 'chevron-up'} size={20} />
          </button>
        </div>
      </div>

      <div className="sheet__body" ref={bodyRef}>
        {audioError ? (
          <div className="alert alert--warn" role="alert">
            <Icon name="alert-triangle" size={18} className="alert__icon" />
            <div>
              <div className="alert__title">Không phát được audio</div>
              Bạn vẫn có thể đọc nội dung bên dưới.
            </div>
          </div>
        ) : null}

        {images.length ? (
          <div className="gallery" role="list">
            {images.map((im, i) => (
              <img
                key={i}
                src={im.url}
                alt={im.caption || `${place.name} — ảnh ${i + 1}`}
                loading="lazy"
                role="listitem"
                className="gallery__img"
              />
            ))}
          </div>
        ) : null}

        {place.text ? (
          <>
            <p className={`sheet__text ${showAll ? '' : 'sheet__text--clamp'}`}>{place.text}</p>
            {place.text.length > 220 ? (
              <button className="linkbtn" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Thu gọn' : 'Xem thêm'}
              </button>
            ) : null}
          </>
        ) : (
          <p className="sheet__text sheet__muted">Điểm này chưa có nội dung văn bản.</p>
        )}
      </div>
    </div>
  );
}
