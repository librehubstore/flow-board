import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Le paquet partagé est consommé en source (TypeScript) par Vite.
    alias: {
      '@flowboard/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3000', ws: true } } },
});
