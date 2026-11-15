// =========================================================
// DiscoverMap — Interactive Map Explorer for Discover (/ ?view=map).
// Shows numbered markers for tours or places, floating map HUD & controls,
// synced scrollable rail on desktop / quick-jump strip on mobile, and a
// floating preview card for the selected destination.
// =========================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import Icon from '../../components/Icon.jsx';
import { formatDistance, formatMinutes, voiceLabel } from '../../lib/format.js';
import { PLACE_TYPE_LABELS } from '../../lib/studio.js';

const createPinIcon = (kind, active, num) =>
  L.divIcon({
    className: 'gs-pin-wrap',
    html: `<div class="gs-pin ${active ? 'gs-pin--active' : ''} ${kind === 'place' ? 'gs-pin--place' : ''}"><span>${num}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });

function detectDarkTheme() {
  if (typeof document === 'undefined') return true;
  const forced = document.documentElement?.dataset?.theme;
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function MapBridge({ points, me, onReady, railOpen }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|');

  useEffect(() => {
    onReady(map);
    return () => onReady(null);
  }, [map, onReady]);

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 200);
    return () => clearTimeout(t);
  }, [map, railOpen]);

  useEffect(() => {
    const all = me ? [...points, me] : points;
    if (all.length === 1) {
      map.setView([all[0].lat, all[0].lng], 15);
    } else if (all.length) {
      map.fitBounds(
        L.latLngBounds(all.map((p) => [p.lat, p.lng])),
        { padding: [48, 48], maxZoom: 15 },
      );
    }
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
  const [map, setMap] = useState(null);
  const [darkTiles, setDarkTiles] = useState(detectDarkTheme);
  const railRefs = useRef(new Map());

  const points = useMemo(
    () =>
      items
        .map((it) =>
          kind === 'tours'
            ? Number.isFinite(it.anchor?.lat) && Number.isFinite(it.anchor?.lng)
              ? { id: it.id, lat: it.anchor.lat, lng: it.anchor.lng, item: it }
              : null
            : Number.isFinite(it.lat) && Number.isFinite(it.lng)
              ? { id: it.placeId, lat: it.lat, lng: it.lng, item: it }
              : null,
        )
        .filter(Boolean),
    [items, kind],
  );

  // Clear selection if the selected point is filtered out
  useEffect(() => {
    if (activeId && !points.some((p) => p.id === activeId)) {
      setActiveId(null);
    }
  }, [points, activeId]);

  const activeIndex = points.findIndex((p) => p.id === activeId);
  const activePoint = activeIndex >= 0 ? points[activeIndex] : null;
  const active = activePoint?.item;
  const center = points[0] ? [points[0].lat, points[0].lng] : [16.05, 108.2];

  const selectPoint = useCallback(
    (point) => {
      setActiveId(point.id);
      if (map) {
        map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 14), { duration: 0.45 });
      }
      const railNode = railRefs.current.get(point.id);
      railNode?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    },
    [map],
  );

  const fitAll = useCallback(() => {
    if (!map) return;
    const all = me ? [...points, me] : points;
    if (all.length === 1) {
      map.flyTo([all[0].lat, all[0].lng], 15, { duration: 0.4 });
    } else if (all.length > 1) {
      map.fitBounds(
        L.latLngBounds(all.map((p) => [p.lat, p.lng])),
        { padding: [48, 48], maxZoom: 15 },
      );
    }
  }, [map, points, me]);

  const setRailRef = (id, node) => {
    if (node) railRefs.current.set(id, node);
    else railRefs.current.delete(id);
  };

  return (
    <div
      className={`discovermap ${points.length ? 'discovermap--withrail' : 'discovermap--emptywrap'} ${
        darkTiles ? 'discovermap--dark' : ''
      }`}
    >
      {points.length ? (
        <aside className="discovermap__rail" aria-label={kind === 'tours' ? 'Tour trên bản đồ' : 'Địa điểm trên bản đồ'}>
          <div className="discovermap__railhead">
            <span className="discovermap__railtitle">
              <Icon name={kind === 'tours' ? 'headphones' : 'map-pin'} size={15} />
              {kind === 'tours' ? 'Tour tại khu vực' : 'Địa điểm gần bạn'}
            </span>
            <span className="discovermap__railbadge">{points.length}</span>
          </div>
          <ul className="discovermap__raillist">
            {points.map((p, index) => {
              const isSelected = p.id === activeId;
              const it = p.item;
              const thumb = kind === 'tours' ? it.coverImageUrl : it.images?.[0]?.url;
              const title = kind === 'tours' ? it.title : it.name;
              const subtitle = kind === 'tours'
                ? `${it.city ? `${it.city} · ` : ''}${it.placeCount ?? 0} điểm`
                : `${PLACE_TYPE_LABELS[it.type] || it.type}${it.city ? ` · ${it.city}` : ''}`;

              return (
                <li key={p.id} ref={(node) => setRailRef(p.id, node)}>
                  <button
                    type="button"
                    className={`discovermap__railitem ${isSelected ? 'is-active' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => selectPoint(p)}
                  >
                    <span className="discovermap__seq">{index + 1}</span>
                    <span className="discovermap__railthumb" aria-hidden="true">
                      {thumb ? (
                        <img src={thumb} alt="" loading="lazy" />
                      ) : (
                        <Icon name={kind === 'tours' ? 'headphones' : 'map-pin'} size={16} />
                      )}
                    </span>
                    <span className="discovermap__railbody">
                      <span className="discovermap__railname">{title}</span>
                      <span className="discovermap__railmeta">
                        {subtitle}
                        {Number.isFinite(it.distanceMeters) ? ` · ${formatDistance(it.distanceMeters)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      <div className="discovermap__stage">
        <MapContainer center={center} zoom={12} zoomControl={false} className="gs-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <MapBridge points={points} me={me} onReady={setMap} railOpen={points.length > 0} />
          {points.map((p, index) => {
            const isSelected = p.id === activeId;
            return (
              <Marker
                key={p.id}
                position={[p.lat, p.lng]}
                icon={createPinIcon(kind === 'tours' ? 'tour' : 'place', isSelected, index + 1)}
                title={kind === 'tours' ? p.item.title : p.item.name}
                zIndexOffset={isSelected ? 1000 : index}
                keyboard
                eventHandlers={{ click: () => selectPoint(p) }}
              />
            );
          })}
        </MapContainer>

        {/* Top-left Map HUD: count pill + map tile theme toggle */}
        <div className="discovermap__hud">
          <div className="discovermap__pill">
            <span className="discovermap__dot" aria-hidden="true" />
            <span>
              {points.length} {kind === 'tours' ? 'tour' : 'địa điểm'}
            </span>
          </div>
          <button
            type="button"
            className="discovermap__pill discovermap__theme"
            onClick={() => setDarkTiles((d) => !d)}
            aria-pressed={darkTiles}
            title={darkTiles ? 'Chuyển bản đồ nền sáng' : 'Chuyển bản đồ nền tối'}
          >
            <Icon name={darkTiles ? 'moon' : 'sun'} size={14} />
            <span>{darkTiles ? 'Bản đồ tối' : 'Bản đồ sáng'}</span>
          </button>
        </div>

        {/* Top-right Map Zoom & Fit Controls */}
        <div className="discovermap__controls" role="group" aria-label="Điều khiển bản đồ">
          <button
            type="button"
            className="discovermap__ctrl"
            onClick={() => map?.zoomIn()}
            aria-label="Phóng to"
            title="Phóng to"
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            className="discovermap__ctrl"
            onClick={() => map?.zoomOut()}
            aria-label="Thu nhỏ"
            title="Thu nhỏ"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
          {points.length ? (
            <button
              type="button"
              className="discovermap__ctrl"
              onClick={fitAll}
              aria-label="Hiện tất cả điểm"
              title="Hiện tất cả điểm"
            >
              <Icon name="crosshair" size={16} />
            </button>
          ) : null}
        </div>

        {!points.length ? (
          <div className="discovermap__empty muted small">Không có kết quả nào có vị trí để hiện trên bản đồ.</div>
        ) : null}

        {active ? (
          <div className="discovermap__card" role="dialog" aria-label="Kết quả đã chọn">
            {kind === 'tours' ? (
              <Link className="discovermap__main" to={`/tour/${active.id}`}>
                {active.coverImageUrl ? (
                  <img src={active.coverImageUrl} alt="" />
                ) : (
                  <span className="discovermap__ph">
                    <Icon name="headphones" size={22} />
                  </span>
                )}
                <span className="discovermap__text">
                  <span className="discovermap__cardtag">Tour #{activeIndex + 1}</span>
                  <b>{active.title}</b>
                  <span className="muted small">
                    {active.city ? `${active.city} · ` : ''}
                    {active.placeCount} điểm
                    {active.duration ? ` · ${formatMinutes(active.duration)}` : ''}
                  </span>
                  {active.voiceLabel ? <span className="discovermap__sub">{voiceLabel(active.voiceLabel)}</span> : null}
                </span>
              </Link>
            ) : (
              <button type="button" className="discovermap__main" onClick={() => onOpenPlace?.(active)}>
                {active.images?.[0]?.url ? (
                  <img src={active.images[0].url} alt="" />
                ) : (
                  <span className="discovermap__ph">
                    <Icon name="map-pin" size={22} />
                  </span>
                )}
                <span className="discovermap__text">
                  <span className="discovermap__cardtag">Điểm #{activeIndex + 1}</span>
                  <b>{active.name}</b>
                  <span className="muted small">
                    {PLACE_TYPE_LABELS[active.type] || active.type}
                    {active.city ? ` · ${active.city}` : ''}
                  </span>
                  {active.tourTitle ? <span className="discovermap__sub">Từ tour: {active.tourTitle}</span> : null}
                </span>
              </button>
            )}
            <div className="discovermap__cardactions">
              {kind === 'places' && onAddPlace ? (
                <button
                  type="button"
                  className="iconbtn discovermap__add"
                  onClick={() => onAddPlace(active)}
                  aria-label={`Thêm ${active.name} vào lịch trình`}
                  title="Thêm vào lịch trình"
                >
                  <Icon name="plus" size={18} />
                </button>
              ) : null}
              <button
                type="button"
                className="iconbtn iconbtn--sm discovermap__close"
                onClick={() => setActiveId(null)}
                aria-label="Đóng"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
