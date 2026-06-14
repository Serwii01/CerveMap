import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Config minima: Vite + React + PWA. Salida estatica lista para Vercel.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['beer.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'CerveMap · Sol y sombra en Sevilla',
        short_name: 'CerveMap',
        description:
          'Elige bar en Sevilla según el sol y la sombra para tomar tu cerveza.',
        lang: 'es',
        dir: 'ltr',
        theme_color: '#f5a524',
        background_color: '#eef1f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['travel', 'food', 'lifestyle'],
        icons: [
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precachea los assets estaticos + el indice de alturas del Catastro (json).
        globPatterns: ['**/*.{js,css,html,svg,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Teselas base de CARTO: cache-first (el mapa sigue viéndose offline).
            urlPattern: /^https:\/\/[a-c]\.basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          // opening_hours es pesado (~110 KB gz): chunk aparte y cacheable.
          openinghours: ['opening_hours'],
        },
      },
    },
  },
});
