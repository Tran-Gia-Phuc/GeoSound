import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA (tech-stack.md §1, §3; UC03 docs/02-design/offline-download.md): the production build's
// service worker precaches the app shell and answers every navigation with index.html, so
// /offline and /offline/:id/play open without network. Tour content and files are NOT cached
// here: downloaded packages live in IndexedDB (lib/offline-store.js). The Vite dev server
// (Docker) does not run the service worker: test true offline with `vite build` + `vite preview`.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'GeoSound',
        short_name: 'GeoSound',
        description: 'Audio guide du lịch theo GPS',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // lắng nghe 0.0.0.0 để truy cập được từ ngoài container.
    // Extra host names allowed by the dev server (comma separated), e.g. an ngrok domain for phone demos.
    // Empty = Vite default (localhost and IP addresses only).
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
    // Proxy gọi API qua gateway để tránh CORS lúc dev.
    // Target cấu hình qua env: local dev -> localhost:8080; trong Docker -> gateway:8080.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
