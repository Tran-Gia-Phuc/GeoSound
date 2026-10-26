import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA: service worker cache tour + audio TTS để chạy offline (tech-stack.md §1, §3).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
