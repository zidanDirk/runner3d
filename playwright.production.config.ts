import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production',
  outputDir: './test-results/production',
  workers: 1,
  timeout: 35000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', launchOptions: { channel: 'chromium' }, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
