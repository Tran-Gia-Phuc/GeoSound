// =========================================================
// TourMap — bản đồ tour (UC04 bước 3): route, vùng kích hoạt, các điểm dừng,
// vị trí GPS trực tiếp. Vùng của điểm ĐANG PHÁT tô hổ phách.
// Chế độ giả lập: chạm bản đồ để đặt vị trí (test không cần ra hiện trường).
// =========================================================
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Circle, Polygon, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// ----- Icon pin số thứ tự (divIcon, né lỗi icon mặc định của Leaflet) -----
function pinIcon(label, { active, visited }) {
  const cls = ['gs-pin', active ? 'gs-pin--active' : '', visited ? 'gs-pin--visited' : ''].join(' ');
  return L.divIcon({
    className: 'gs-pin-wrap',
    html: `<div class="${cls}"><span>${label}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });
}

function userIcon(stale) {
  return L.divIcon({
    className: 'gs-user-wrap',
    html: `<div class="gs-user ${stale ? 'gs-user--stale' : ''}"><span class="gs-user__dot"></span><span class="gs-user__pulse"></span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const toLatLng = (ring) => ring.map(([lng, lat]) => [lat, lng]); // GeoJSON -> Leaflet

// Canh khung ban đầu + theo dõi người dùng + sửa kích thước khi mở sheet.
function MapController({ bounds, follow, userPos, recenterNonce }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (follow && userPos) map.panTo([userPos.lat, userPos.lng], { animate: true });
  }, [follow, userPos, map]);
  // Nút "về vị trí của tôi".
  useEffect(() => {
    if (recenterNonce && userPos) map.setView([userPos.lat, userPos.lng], Math.max(map.getZoom(), 17), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce]);
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  });
  return null;
}

function ClickToSimulate({ onPick }) {
  useMapEvents({ click: (e) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function TourMap({
  tour,
  activePlaceId,
  visitedIds,
  userPos,
  follow,
  simulate,
  recenterNonce,
  onSelectPlace,
  onSimPick,
}) {
  const places = tour?.places ?? [];
  const triggers = tour?.route?.triggers ?? [];
  const path = tour?.route?.path ?? [];
  const navAudios = tour?.route?.navAudios ?? [];
  const triggerByPlace = useMemo(() => new Map(triggers.map((t) => [t.placeId, t])), [triggers]);

  const pts = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const center = pts.length ? [pts[0].lat, pts[0].lng] : [21.0278, 105.8342]; // mặc định Hà Nội

  const bounds = useMemo(() => {
    const coords = [
      ...pts.map((p) => [p.lat, p.lng]),
      ...path.filter((c) => Number.isFinite(c.lat)).map((c) => [c.lat, c.lng]),
    ];
    return coords.length ? L.latLngBounds(coords) : null;
  }, [pts, path]);

  const visited = visitedIds instanceof Set ? visitedIds : new Set(visitedIds || []);

  return (
    <MapContainer
      center={center}
      zoom={16}
      zoomControl={false}
      className="gs-map"
      attributionControl
      style={{ cursor: simulate ? 'crosshair' : '' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <MapController bounds={bounds} follow={follow} userPos={userPos} recenterNonce={recenterNonce} />
      {simulate ? <ClickToSimulate onPick={onSimPick} /> : null}

      {/* Route nối các điểm */}
      {path.length > 1 ? (
        <Polyline
          positions={path.map((c) => [c.lat, c.lng])}
          pathOptions={{ color: '#0d9488', weight: 5, opacity: 0.85, dashArray: '1 10', lineCap: 'round' }}
        />
      ) : null}

      {/* Vùng chỉ đường (ngã rẽ) */}
      {navAudios.map((n) =>
        n.zone?.shape === 'circle' ? (
          <Circle
            key={`nav-${n.id}`}
            center={[n.zone.center.lat, n.zone.center.lng]}
            radius={n.zone.radiusMeters}
            pathOptions={{ color: '#64748b', weight: 1, fillOpacity: 0.06, dashArray: '4 4' }}
          />
        ) : n.zone?.shape === 'polygon' ? (
          <Polygon
            key={`nav-${n.id}`}
            positions={toLatLng(n.zone.geometry.coordinates[0])}
            pathOptions={{ color: '#64748b', weight: 1, fillOpacity: 0.06, dashArray: '4 4' }}
          />
        ) : null,
      )}

      {/* Vùng kích hoạt của từng điểm */}
      {places.map((p) => {
        const zone = triggerByPlace.get(p.id)?.zone;
        if (!zone) return null;
        const act = p.id === activePlaceId;
        const opt = {
          color: act ? '#c2600a' : '#0f766e',
          weight: act ? 2.5 : 1.5,
          fillColor: act ? '#f59e0b' : '#14b8a6',
          fillOpacity: act ? 0.22 : 0.08,
        };
        if (zone.shape === 'circle') {
          return <Circle key={`z-${p.id}`} center={[zone.center.lat, zone.center.lng]} radius={zone.radiusMeters} pathOptions={opt} />;
        }
        return <Polygon key={`z-${p.id}`} positions={toLatLng(zone.geometry.coordinates[0])} pathOptions={opt} />;
      })}

      {/* Marker điểm dừng */}
      {pts.map((p, i) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={pinIcon(p.sequence ?? i + 1, { active: p.id === activePlaceId, visited: visited.has(p.id) })}
          keyboard
          eventHandlers={{ click: () => onSelectPlace?.(p.id) }}
          title={p.name}
        />
      ))}

      {/* Vị trí người dùng + vòng độ chính xác */}
      {userPos ? (
        <>
          {Number.isFinite(userPos.accuracy) && userPos.accuracy > 0 ? (
            <Circle
              center={[userPos.lat, userPos.lng]}
              radius={userPos.accuracy}
              pathOptions={{ color: '#0d9488', weight: 1, fillOpacity: 0.08 }}
            />
          ) : null}
          <Marker position={[userPos.lat, userPos.lng]} icon={userIcon(userPos.stale)} zIndexOffset={1000} interactive={false} />
        </>
      ) : null}
    </MapContainer>
  );
}
