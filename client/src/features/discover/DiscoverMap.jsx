// =========================================================
// DiscoverMap — kết quả Khám phá trên bản đồ (UC02 / UC07 bước 2: "xem dạng bản
// đồ hoặc danh sách"). Tour: ghim ở điểm xuất phát; Địa điểm: ghim tại chỗ.
// Chạm ghim → thẻ tóm tắt nổi ở đáy bản đồ (mở chi tiết / thêm vào lịch trình).
// =========================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import Icon from '../../components/Icon.jsx';
import { formatMinutes, voiceLabel } from '../../lib/format.js';
import { PLACE_TYPE_LABELS } from '../../lib/studio.js';

const pin = (kind, active) =>
  L.divIcon({
    className: 'gs-pin-wrap',
    html: `<div class="gs-pin ${active ? 'gs-pin--active' : ''} ${kind === 'place' ? 'gs-pin--place' : ''}"><span>${kind === 'place' ? '●' : '♪'}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });

function FitAll({ points, me }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    const all = me ? [...points, me] : points;
    if (all.length === 1) map.setView([all[0].lat, all[0].lng], 15);
    else if (all.length) map.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/**
 * @param {{ kind: 'tours'|'places', items: any[], me?: {lat,lng}|null,
 *           onOpenPlace?: (p) => void, onAddPlace?: (p) => void }} props
 */
export default function DiscoverMap({ kind, items, me, onOpenPlace, onAddPlace }) {
  const [activeId, setActiveId] = useState(null);

  const points = useMemo(
    () =>
      items
        .map((it) =>
          kind === 'tours'
            ? it.anchor ? { id: it.id, lat: it.anchor.lat, lng: it.anchor.lng, item: it } : null
            : Number.isFinite(it.lat) ? { id: it.placeId, lat: it.lat, lng: it.lng, item: it } : null,
        )
        .filter(Boolean),
    [items, kind],
  );
  const active = points.find((p) => p.id === activeId)?.item;
  const center = points[0] ? [points[0].lat, points[0].lng] : [16.05, 108.2];

  return (
    <div className="discovermap">
      <MapContainer center={center} zoom={12} zoomControl={false} className="gs-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitAll points={points} me={me} />
        {points.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pin(kind === 'tours' ? 'tour' : 'place', p.id === activeId)}
            title={kind === 'tours' ? p.item.title : p.item.name}
            keyboard
            eventHandlers={{ click: () => setActiveId(p.id) }}
          />
        ))}
      </MapContainer>

      {!points.length ? (
        <div className="discovermap__empty muted small">Không có kết quả nào có vị trí để hiện trên bản đồ.</div>
      ) : null}

      {active ? (
        <div className="discovermap__card" role="dialog" aria-label="Kết quả đã chọn">
          {kind === 'tours' ? (
            <Link className="discovermap__main" to={`/tour/${active.id}`}>
              {active.coverImageUrl ? <img src={active.coverImageUrl} alt="" /> : <span className="discovermap__ph"><Icon name="headphones" size={22} /></span>}
              <span className="discovermap__text">
                <b>{active.title}</b>
                <span className="muted small">
                  {active.city ? `${active.city} · ` : ''}{active.placeCount} điểm
                  {active.duration ? ` · ${formatMinutes(active.duration)}` : ''}
                </span>
                <span className="muted small">{voiceLabel(active.voiceLabel)}</span>
              </span>
            </Link>
          ) : (
            <button className="discovermap__main" onClick={() => onOpenPlace?.(active)}>
              {active.images?.[0]?.url ? <img src={active.images[0].url} alt="" /> : <span className="discovermap__ph"><Icon name="map-pin" size={22} /></span>}
              <span className="discovermap__text">
                <b>{active.name}</b>
                <span className="muted small">{PLACE_TYPE_LABELS[active.type] || active.type}{active.city ? ` · ${active.city}` : ''}</span>
                {active.tourTitle ? <span className="muted small">Từ tour: {active.tourTitle}</span> : null}
              </span>
            </button>
          )}
          {kind === 'places' && onAddPlace ? (
            <button className="iconbtn place-card__plus" onClick={() => onAddPlace(active)} aria-label={`Thêm ${active.name} vào lịch trình`}>
              <Icon name="plus" size={18} />
            </button>
          ) : null}
          <button className="iconbtn iconbtn--sm discovermap__close" onClick={() => setActiveId(null)} aria-label="Đóng">
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
