// Skeleton màn hình. Routing + map (Leaflet) + luồng 3 actor thêm sau.
const API = import.meta.env.VITE_API_BASE_URL || '';

export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.5 }}>
      <h1>GeoSound</h1>
      <p>Audio guide du lịch theo GPS. Skeleton PWA — 1 codebase cho Tourist / Contributor / Admin.</p>
      <p>Gateway API: <code>{API || '(đặt VITE_API_BASE_URL)'}</code></p>
      <p>TODO: routing theo vai trò, bản đồ Leaflet, offline cache tour + audio.</p>
    </main>
  );
}
