import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 8787}`, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: api,
  },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), proxy: api },
  build: { sourcemap: false, target: 'es2022' },
});
