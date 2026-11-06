import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { currentActualSelection, assertActualRuntime } from '../../scripts/visual/actual-evidence.mjs';
import { collectVisualProvenance } from '../e2e/visual-provenance';

export default async function recordActualContext(config: FullConfig) {
  const selection = currentActualSelection();
  const project = config.projects[0];
  if (!project || config.projects.length !== 1) throw new Error('Actual evidence requires one Chromium project');
  const use = project.use;
  const browser = await chromium.launch({ ...use.launchOptions, timeout: 30000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch, locale: use.locale, colorScheme: use.colorScheme });
    const page = await context.newPage();
    page.setDefaultTimeout(25000); page.setDefaultNavigationTimeout(25000);
    const facts = await Promise.race([collectVisualProvenance(page, browser.version()),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Actual context probe timed out')), 60000); })]);
    assertActualRuntime(selection, facts);
    mkdirSync('artifacts/visual-actual', { recursive: true });
    writeFileSync('artifacts/visual-actual/context.json', JSON.stringify({ selection, eligibleForRelease: false, purpose: 'diagnostic-only-not-approval', ...facts,
      runner: { ...facts.runner, imageVersion: facts.runner.imageVersion ?? null },
      missingRemoteFields: selection.phase === 'local-verification' ? ['GitHub Run ID', 'GitHub Attempt', 'Reviewed remote source SHA', 'GitHub ImageVersion validation'] : [] }, null, 2) + '\n');
  } finally { if (timer) clearTimeout(timer); await browser.close(); }
}
