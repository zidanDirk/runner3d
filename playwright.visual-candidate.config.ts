import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { currentCandidateDiagnostic } from './scripts/visual/candidate.mjs';

// A separate, explicitly requested evidence path. The formal CI selector and
// its image allowlist remain unchanged; this configuration cannot approve it.
const candidate = currentCandidateDiagnostic();
export default defineConfig(base, {
  globalSetup: [],
  updateSnapshots: 'none',
  snapshotPathTemplate: candidate.snapshotPathTemplate,
  outputDir: './test-results/visual-candidate',
  metadata: { visualCandidate: candidate },
  reporter: [['list'], ['json', { outputFile: 'artifacts/visual-candidate/comparison.json' }]],
  use: { screenshot: 'on', trace: 'retain-on-failure' },
});
