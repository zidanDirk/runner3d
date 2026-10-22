import { requestGameScene } from './session-helpers';
import { expect, test } from '@playwright/test';

// Baselines are created/replaced only by the explicit test:visual:update command.
for (const [name, distance] of [['city-start', 0], ['city-near-player', 18], ['city-next-chunk', 95]] as const) {
  test(`visual ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await requestGameScene(page);
    await page.waitForFunction(() => !!window.__RUNNER_TEST__ && window.__CITY_RENDER__?.fallbackBatches === 0
      && window.__CITY_RENDER__.batches === window.__CITY_RENDER__.expectedBatches && (window.__RUNNER_RENDER__?.roadblock.models ?? 0) > 0
      && window.__RUNNER_RENDER__?.roadblock.fallbacks === 0 && window.__RUNNER_RENDER__?.character.models === 1
      && window.__RUNNER_RENDER__?.character.fallbacks === 0);
    const applied = await page.evaluate((distance) => window.__RUNNER_TEST__?.captureAt('RUNNER-01', distance), distance);
    expect(applied?.seed).toBe('RUNNER-01');
    expect(applied?.distance).toBeGreaterThanOrEqual(distance);
    expect(applied?.distance).toBeLessThan(distance + 0.21);
    await page.waitForFunction(({ chunk, distance }) => {
      const stats = window.__CITY_RENDER__;
      return !!stats && stats.currentChunk === chunk && stats.distance === distance && stats.fallbackBatches === 0;
    }, { chunk: applied?.chunk, distance: applied?.distance });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/visual-actual/${name}.png` });
    await expect(page.locator('.game-stage')).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled', maxDiffPixelRatio: 0.01, threshold: 0.22,
    });
    expect(errors).toEqual([]);
  });
}
