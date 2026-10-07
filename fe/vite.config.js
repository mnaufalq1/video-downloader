import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend Express berjalan di port 5000 (default backend di src/index.ts)
const BACKEND_TARGET = 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Semua request /api/... diteruskan ke backend Express
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
});