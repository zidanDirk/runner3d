import { expect, test } from '@playwright/test';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

for (const [name, distance] of [['dusk', 95], ['neon', 780], ['transition-start', 600], ['transition-middle', 630], ['transition-end', 660]] as const) {
  test(`visual theme ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await waitForThemeAssets(page);
    await captureThemeAt(page, distance);
    await page.locator('.game-stage').screenshot({ path: `artifacts/visual-actual/theme-${name}.png` });
    await expect(page.locator('.game-stage')).toHaveScreenshot(`theme-${name}.png`, { animations: 'disabled', threshold: 0.22, maxDiffPixelRatio: 0.01 });
    await page.locator('.game-stage').screenshot({ path: `artifacts/screenshots/theme-${name}.png` });
    expect(errors).toEqual([]);
  });
}

test('visual Neon theme asset preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?themePreview=neon-city');
  await expect.poll(() => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}).length)).toBe(4);
  await expect(page.getByTestId('preview-calls')).not.toHaveText('0');
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.locator('.asset-viewer-column').screenshot({ path: 'artifacts/visual-actual/neon-theme-preview.png' });
  await expect(page.locator('.asset-viewer-column')).toHaveScreenshot('neon-theme-preview.png', { animations: 'disabled', threshold: 0.22, maxDiffPixelRatio: 0.01 });
  await page.locator('.asset-viewer-column').screenshot({ path: 'artifacts/screenshots/theme-neon-preview.png' });
  expect(errors).toEqual([]);
});
