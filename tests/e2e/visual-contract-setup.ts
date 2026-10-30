import { chromium } from '@playwright/test';
import type { Browser, FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { currentVisualPlatform } from '../../scripts/visual/platform.mjs';
import { assertVisualRuntimeContract } from '../../scripts/visual/contracts.mjs';
import { collectVisualProvenance } from './visual-provenance';

/** Formal comparison requires real browser facts before any of its 77 tests. */
export default async function verifyVisualRuntime(config: FullConfig) {
  const comparison = currentVisualPlatform();
  if (comparison.id === 'local-original') throw new Error('A formal visual contract is required');
  const project = config.projects[0];
  if (config.projects.length !== 1 || !project || (project.use.browserName && project.use.browserName !== 'chromium')) throw new Error('Visual runtime probe requires the single Chromium comparison project');
  const use = project.use;
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const directory = 'test-results/visual-contract';
  mkdirSync(directory, { recursive: true });
  try {
    const probe = async () => {
      browser = await chromium.launch({ ...use.launchOptions, ...(use.channel ? { channel: use.channel } : {}),
        ...(use.headless === undefined ? {} : { headless: use.headless }), timeout: 30000 });
      const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent,
        deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch, locale: use.locale,
        colorScheme: use.colorScheme, reducedMotion: use.reducedMotion, timezoneId: use.timezoneId });
      const page = await context.newPage();
      page.setDefaultTimeout(25000); page.setDefaultNavigationTimeout(25000);
      return collectVisualProvenance(page, browser.version());
    };
    const report = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Visual contract probe exceeded its 60 second budget')), 60000); }),
    ]);
    writeFileSync(`${directory}/visual-provenance.json`, JSON.stringify({ comparison, purpose: 'formal-preflight', ...report }, null, 2) + '\n');
    assertVisualRuntimeContract(comparison.id, { browserVersion: report.host.browser, actualFonts: report.actualFonts,
      renderer: report.renderer, vendor: report.vendor, devicePixelRatio: report.devicePixelRatio });
    writeFileSync(`${directory}/result.json`, JSON.stringify({ status: 'PASS', contractId: comparison.contractId, screenshotTestsStarted: false }, null, 2) + '\n');
  } catch (error) {
    writeFileSync(`${directory}/result.json`, JSON.stringify({ status: 'FAIL', errorCode: 'VISUAL_RUNTIME_CONTRACT_REJECTED', screenshotTestsStarted: false }, null, 2) + '\n');
    throw error;
  } finally { if (timer) clearTimeout(timer); await browser?.close(); }
}
