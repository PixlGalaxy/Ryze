import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Lets you tunnel the Vite dev server (cloudflared/ngrok) while developing.
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:3000', '/cdn': 'http://localhost:3000' },
  },
});
