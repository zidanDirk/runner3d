import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// A fixed single-test observation before font matching; no screenshot assertions.
// The formal host selector still applies, and this cannot grant approval.
export default defineConfig(base, {
  globalSetup: [],
  testMatch: '**/00-visual-provenance.spec.ts',
  metadata: { visualObservationOnly: true },
});
