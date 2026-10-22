import { expect, test } from '@playwright/test';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

// The URL is a paused time in seconds. Normal test runs cannot create baselines.
for (const [name, animation, seconds, view, skeleton] of [
  ['idle-front', 'idle', 0, '正面', false],
  ['run-left-contact', 'run', 0, '左侧', false],
  ['run-right-contact', 'run', .36, '左侧', false],
  ['run-passing', 'run', .18, '45°', false],
  ['run-front', 'run', .18, '正面', false],
  ['run-back', 'run', .54, '背面', false],
  ['jump-takeoff', 'jump', .095, '左侧', false],
  ['jump-air', 'jump', .475, '45°', false],
  ['slide', 'slide', .375, '左侧', false],
  ['skeleton', 'run', .18, '45°', true],
] as const) {
  test(`visual animation ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(request.url()));
    await page.goto(`/?characterPreview=city-runner&animation=${animation}&animationTime=${seconds}${skeleton ? '&showSkeleton=1' : ''}`);
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForFunction(({ animation, seconds }) => {
      const stats = window.__ASSET_PREVIEW__;
      return !!stats?.models['city-runner'] && stats.animation?.state === animation
        && stats.animation.paused && Math.abs(stats.animation.time - seconds) < .001;
    }, { animation, seconds });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.locator('.asset-viewport').screenshot({ path: `artifacts/ui-ux/regression/visual-actual/animation-${name}.png` });
    await expect(page.locator('.asset-viewport')).toHaveScreenshot(`animation-${name}.png`, { animations: 'disabled', threshold: .22, maxDiffPixelRatio: .003 });
    expect(errors).toEqual([]);
  });
}

for (const [side, key] of [['left', 'a'], ['right', 'd']] as const) {
  test(`visual animation lean ${side}`, async ({ page }) => {
    await page.goto('/');
    await waitForThemeAssets(page);
    await captureThemeAt(page, 0);
    await page.keyboard.press(key);
    await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(4));
    await page.waitForFunction(() => window.__RUNNER_TEST__?.read().tick === 4 && Math.abs(window.__RUNNER_RENDER__?.character.lean ?? 0) > .02);
    await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/visual-actual/animation-lean-${side}.png` });
    await expect(page.locator('.game-stage')).toHaveScreenshot(`animation-lean-${side}.png`, { animations: 'disabled', threshold: .22, maxDiffPixelRatio: .003 });
  });
}
