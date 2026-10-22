import { defineConfig } from '@playwright/test';
import base from './playwright.config';
process.env.RELEASE_ENV ??= 'preview';
export default defineConfig({
  ...base, testDir: './tests/beta', outputDir: './test-results/task14/beta',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5184', trace: 'off' },
  webServer: {
    command: 'npx vite build --mode e2e --outDir artifacts/beta/browser-build && npm run preview -- --outDir artifacts/beta/browser-build --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184', reuseExistingServer: false,
  },
});
