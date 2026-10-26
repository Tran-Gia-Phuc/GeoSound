// =========================================================
// PlaceDetailSheet (UC07 bước 3) — xem chi tiết một địa điểm trước khi thêm vào
// lịch trình: ảnh, mô tả, nghe thử (audio người thật hoặc giọng máy), tour gốc.
// =========================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { PLACE_TYPE_LABELS } from '../../lib/studio.js';
import { formatDistance } from '../../lib/format.js';
import { playPreview, stopPreview } from '../../lib/preview-audio.js';

export default function PlaceDetailSheet({ place, onClose, onAdd }) {
  const [playing, setPlaying] = useState(false);

  // Đóng sheet / đổi địa điểm → dừng nghe thử.
  useEffect(() => {
    setPlaying(false);
    return () => stopPreview();
  }, [place?.placeId]);

  if (!place) return null;
  const images = (place.images || []).map((im) => (typeof im === 'string' ? { url: im } : im)).filter((im) => im.url);

  const toggle = () => {
    if (playing) {
      stopPreview();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    playPreview({ url: place.audioUrl, text: place.description, lang: place.language, onEnd: () => setPlaying(false) });
  };

  return (
    <Modal open={!!place} onClose={onClose} title={place.name} labelledBy="place-sheet-title">
      <div className="placesheet">
        <div className="placesheet__meta">
          <span className="chip">{PLACE_TYPE_LABELS[place.type] || place.type}</span>
          {place.city ? <span className="muted small"><Icon name="map-pin" size={13} /> {place.city}</span> : null}
          {Number.isFinite(place.distanceMeters) ? (
            <span className="muted small"><Icon name="navigation" size={13} /> cách {formatDistance(place.distanceMeters)}</span>
          ) : null}
        </div>

        {images.length ? (
          <div className="gallery" role="list">
            {images.map((im, i) => (
              <img key={i} src={im.url} alt={im.caption || `${place.name} — ảnh ${i + 1}`} loading="lazy" role="listitem" className="gallery__img" />
            ))}
          </div>
        ) : null}

        {place.description ? <p className="placesheet__desc">{place.description}</p> : null}

        {place.tourTitle ? (
          <p className="muted small">
            Thuộc tour <Link className="linkbtn" to={`/tour/${place.tourId}`} onClick={onClose}>{place.tourTitle}</Link>
          </p>
        ) : null}

        <div className="placesheet__actions">
          <button className="btn" onClick={toggle} disabled={!place.audioUrl && !place.description}>
            <Icon name={playing ? 'pause' : 'headphones'} size={18} />
            {playing ? 'Dừng' : 'Nghe thử'}
          </button>
          <button className="btn btn--primary" onClick={() => onAdd(place)}>
            <Icon name="plus" size={18} /> Thêm vào lịch trình
          </button>
        </div>
      </div>
    </Modal>
  );
}
