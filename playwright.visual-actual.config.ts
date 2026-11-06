import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { currentActualSelection } from './scripts/visual/actual-evidence.mjs';

const actualDiagnostic = currentActualSelection();
const mode = process.env.RUNNER3D_ACTUAL_SUITE_MODE;
if (!['native', 'instrumented'].includes(mode ?? '')) throw new Error('Explicit actual evidence suite mode required');
export default defineConfig(base, {
  globalSetup: './tests/diagnostics/actual-context-setup.ts',
  snapshotPathTemplate: actualDiagnostic.snapshotPathTemplate,
  updateSnapshots: 'none',
  outputDir: `./test-results/visual-actual/${mode}`,
  metadata: { actualDiagnostic },
  reporter: [['list'], ['json', { outputFile: `artifacts/visual-actual/suite-${mode}/report.json` }]],
});
