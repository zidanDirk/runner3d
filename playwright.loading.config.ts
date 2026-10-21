import { defineConfig } from '@playwright/test';
const baseline = process.env.LOAD_BASELINE === '1';
export default defineConfig({
  testDir: './tests/loading', outputDir: './test-results/loading', workers: 1, timeout: 35000,
  reporter: [['list']], use: { baseURL: 'http://127.0.0.1:4175', launchOptions: { channel: 'chromium' } },
  webServer: {
    command: baseline ? 'npm run preview -- --outDir artifacts/mobile-iteration/task9/dist --port 4175 --strictPort' : 'npm run preview -- --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175', reuseExistingServer: false,
  },
});
