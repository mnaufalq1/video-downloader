import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Backend Express berjalan di port 5000 (default backend di src/index.ts)
// NB: vite.config.js dijalankan oleh Node, jadi TIDAK bisa pakai
// `import.meta.env`. Harus pakai loadEnv(mode, ...) dari 'vite'.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const BACKEND_TARGET = env.VITE_API_URL || 'http://localhost:5000';

  return {
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
  };
});