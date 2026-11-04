import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Internal Compose hostname used by the tools container's smoke check.
    allowedHosts: ['web'],
    watch: { usePolling: process.env.WATCH_POLLING === 'true' },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
      },
    },
  },
});
