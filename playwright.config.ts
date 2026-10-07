import { defineConfig } from '@playwright/test';

const PORT = 3100;
const MONGO_URL = `${process.env.TEST_MONGO_URL ?? 'mongodb://localhost:27017'}/flowboard_e2e`;

/**
 * Recette E2E. Par défaut : application construite (`npm run build`) démarrée ici, base dédiée vidée au démarrage.
 * E2E_BASE_URL : cible une pile déjà démarrée (ex. docker compose : web → api → mongo), base vierge exigée.
 */
const external = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : {
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
