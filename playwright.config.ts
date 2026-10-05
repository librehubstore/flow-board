import { defineConfig } from '@playwright/test';

const PORT = 3100;
const MONGO_URL = 'mongodb://localhost:27017/flowboard_e2e';

/** Recette E2E sur l'application construite (`npm run build`), base dédiée vidée au démarrage. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/start.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      MONGO_URL,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin-initial-1',
      COOKIE_SECURE: 'false',
      UPLOAD_DIR: 'test-results/uploads',
    },
  },
});
