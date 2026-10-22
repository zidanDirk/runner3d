import { defineConfig } from '@playwright/test';
import base from './playwright.config';
process.env.PRODUCT_OPTIMIZED = '1';

// Real fixed-step journeys with optimized JS and no development React Refresh
// root registry. Explicit MODE=e2e hooks remain here; normal dist strips them.
export default defineConfig({
  ...base,
  testMatch: 'product-performance.spec.ts',
  outputDir: './test-results/task13/product-performance',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5176', trace: 'off' },
  webServer: {
    command: 'npx vite build --mode e2e --outDir artifacts/ui-ux/performance-build && npm run preview -- --outDir artifacts/ui-ux/performance-build --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
  },
});
