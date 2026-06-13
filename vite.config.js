import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Config minima: Vite + React. Salida estatica lista para Vercel.
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
});
