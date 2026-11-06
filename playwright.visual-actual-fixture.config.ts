import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { assertNoSnapshotUpdates } from './scripts/visual/candidate.mjs';
assertNoSnapshotUpdates(process.argv);
const mode = process.env.RUNNER3D_ACTUAL_FIXTURE_MODE;
if (!['native', 'instrumented'].includes(mode ?? '')) throw new Error('Explicit actual fixture mode required');
export default defineConfig({
  testDir: './tests/diagnostics', testMatch: '**/actual-equivalence.spec.ts', workers: 1, fullyParallel: false, retries: 0,
  updateSnapshots: 'none', timeout: 35000,
  snapshotPathTemplate: resolve('artifacts/visual-actual/fixture-references/{arg}{ext}'),
  outputDir: `test-results/visual-actual-fixture/${mode}`,
  reporter: [['list'], ['json', { outputFile: `artifacts/visual-actual/fixture-${mode}/report.json` }]],
  use: { ...devices['Desktop Chrome'], viewport: { width: 200, height: 120 }, launchOptions: { channel: 'chromium' }, trace: 'retain-on-failure' },
});
