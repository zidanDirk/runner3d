import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { requestGameScene } from './session-helpers';

export async function waitForThemeAssets(page: Page) {
  await requestGameScene(page);
  await page.waitForFunction(() => {
    const stats = window.__CITY_RENDER__;
    return !!window.__RUNNER_TEST__ && !!stats && stats.batches === stats.expectedBatches
      && stats.fallbackBatches === 0 && (window.__RUNNER_RENDER__?.roadblock.models ?? 0) > 0
      && window.__RUNNER_RENDER__?.roadblock.fallbacks === 0
      && window.__RUNNER_RENDER__?.character.models === 1 && window.__RUNNER_RENDER__?.character.fallbacks === 0 && !!window.__RUNNER_RENDER__?.character.animation;
  });
}

export async function captureThemeAt(page: Page, distance: number, advance = false) {
  const previousSample = await page.evaluate(() => window.__CITY_RENDER__?.sample ?? 0);
  const applied = await page.evaluate(({ distance, advance }) => {
    const hooks = window.__RUNNER_TEST__;
    if (!hooks) throw new Error('Theme capture hooks missing');
    return advance ? hooks.advanceTo(distance) : hooks.captureAt('RUNNER-01', distance);
  }, { distance, advance });
  expect(applied.distance).toBeGreaterThanOrEqual(distance);
  expect(applied.distance).toBeLessThan(distance + 0.21);
  await page.waitForFunction(({ distance, previousSample }) => {
    const stats = window.__CITY_RENDER__;
    return stats?.distance === distance && stats.sample > previousSample && stats.fallbackBatches === 0 && stats.batches === stats.expectedBatches;
  }, { distance: applied.distance, previousSample });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const stats = await page.evaluate(() => window.__CITY_RENDER__);
  if (!stats) throw new Error('Theme render diagnostics missing');
  return stats;
}
