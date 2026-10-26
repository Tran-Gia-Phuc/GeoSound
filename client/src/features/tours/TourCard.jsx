// Thẻ kết quả tìm kiếm (UC02 bước 5). Toàn thẻ là liên kết tới chi tiết tour.
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import Rating from './Rating.jsx';
import { TOUR_TYPE_LABELS } from '../../lib/tours.js';
import { formatDistance, formatMinutes, langLabel, voiceLabel, isHumanVoice } from '../../lib/format.js';

export default function TourCard({ tour }) {
  const hasHuman = isHumanVoice(tour.voiceLabel);
  return (
    <li>
      <Link className="tour-card" to={`/tour/${encodeURIComponent(tour.id)}`}>
        <div className="tour-card__cover">
          {tour.coverImageUrl ? (
            <img src={tour.coverImageUrl} alt="" loading="lazy" />
          ) : (
            <Icon name="image" size={28} title={`Ảnh bìa tour ${tour.title}`} />
          )}
          {tour.voiceLabel ? (
            <span className={`chip tour-card__voice ${hasHuman ? 'chip--human' : ''}`}>
              <Icon name="volume" size={13} /> {voiceLabel(tour.voiceLabel)}
            </span>
          ) : null}
        </div>

        <div className="tour-card__body">
          <h3 className="tour-card__title">{tour.title}</h3>

          <div className="tour-card__meta">
            {tour.city ? (
              <span className="muted small tour-card__city">
                <Icon name="map-pin" size={13} /> {tour.city}
              </span>
            ) : null}
            {tour.type ? <span className="chip">{TOUR_TYPE_LABELS[tour.type] || tour.type}</span> : null}
            {tour.originalLanguage ? <span className="chip">{langLabel(tour.originalLanguage)}</span> : null}
          </div>

          <div className="tour-card__meta muted small">
            <span><Icon name="map-pin" size={13} /> {tour.placeCount ?? 0} điểm</span>
            {tour.duration ? <span><Icon name="clock" size={13} /> {formatMinutes(tour.duration)}</span> : null}
            {Number.isFinite(tour.distanceMeters) ? (
              <span><Icon name="navigation" size={13} /> cách {formatDistance(tour.distanceMeters)}</span>
            ) : null}
          </div>

          <div className="tour-card__foot">
            <Rating value={tour.averageRating} count={tour.ratingCount} />
            <span className="tour-card__go">
              Xem <Icon name="chevron-left" size={16} className="tour-card__chev" />
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
