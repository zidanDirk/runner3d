import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const release: unknown = JSON.parse(readFileSync('dist/release.json', 'utf8'));
if (typeof release !== 'object' || release === null || !('buildId' in release) || typeof release.buildId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(release.buildId)) throw new Error('Build a verified release before test:release');
const localURL = `http://127.0.0.1:4186/beta/releases/${release.buildId}/`;
const externalURL = process.env.RELEASE_TEST_URL;
if (externalURL && (new URL(externalURL).protocol !== 'https:' || !externalURL.endsWith('/'))) throw new Error('Remote release smoke requires a trailing-slash HTTPS URL');
export default defineConfig({
  testDir: './tests/release', outputDir: './test-results/task14/release', workers: 1, timeout: 45000,
  updateSnapshots: 'none', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: externalURL ?? localURL, viewport: { width: 1440, height: 1000 }, launchOptions: { channel: 'chromium' }, screenshot: 'only-on-failure' },
  ...(externalURL ? {} : { webServer: { command: 'node scripts/release/serve.mjs', url: localURL, reuseExistingServer: false } }),
});
