import { defineConfig, devices } from '@playwright/test';

const API = 'http://127.0.0.1:8787';
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
  webServer: [
    {
      command: 'npm run start -w backend',
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ENVIRONMENT: 'test', PORT: '8787', SQLITE_PATH: '/tmp/sdu_e2e.sqlite', AI_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: '', SKIP_MX: '1',
        RATE_LIMIT_MULTIPLIER: '1000', APP_SECRET: 'e2e-secret', MAILPIT_URL: '', TRUST_PROXY_HEADERS: '1',
        ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173',
      },
    },
    {
      command: 'npm run build -w frontend && npm run preview -w frontend -- --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
