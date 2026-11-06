import { defineConfig } from '@playwright/test';
import base from '../../playwright.release.config';
import { fileURLToPath } from 'node:url';
const run = process.env.ROUTE_RUN_ID;
if (!run || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(run)) throw new Error('Set a unique ROUTE_RUN_ID');
if (Array.isArray(base.webServer)) throw new Error('Expected the existing single release server');
export default defineConfig({ ...base,
  testDir: '.', testMatch: 'route-latency.diagnostic.ts',
  outputDir: `../../test-results/route-latency/${run}`,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL(`../../test-results/route-latency/${run}/playwright.json`, import.meta.url)) }]],
  use: { ...base.use, trace: 'on' },
  ...(base.webServer ? { webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../../', import.meta.url)) } } : {}),
  metadata: { diagnosticOnly: true, eligibleForRelease: false, run },
});
