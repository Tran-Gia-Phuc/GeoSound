// Raster tile source shared by every Leaflet map in the client.
// Esri World Street Map instead of tile.openstreetmap.org: some home routers
// fail to resolve the OSM tile host (empty map background) and the OSM
// volunteer servers discourage app traffic. CARTO basemaps now need an API key.
// No subdomains and no {r} (Esri has no @2x tiles); the URL order is z/y/x.
export const MAP_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

// Esri has street detail up to zoom 17 everywhere in Vietnam (zoom 18 only in
// some cities); Leaflet scales zoom 17 tiles up for zoom 18 and 19.
export const MAP_TILE_MAX_NATIVE_ZOOM = 17;

export const MAP_TILE_MAX_ZOOM = 19;

export const MAP_TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
