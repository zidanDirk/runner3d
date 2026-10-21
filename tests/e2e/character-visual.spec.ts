import { expect, test } from '@playwright/test';

// Close views supplement the existing city baselines, where a runner is small.
// Creation/update is explicit through test:visual:update, never normal execution.
for (const [preset, label] of [['front', '正面'], ['back', '背面'], ['left', '左侧'], ['right', '右侧'], ['three-quarter', '45°']] as const) {
  test(`visual character ${preset}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(request.url()));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?characterPreview=city-runner');
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: '查看 city-runner', exact: true })).toHaveAttribute('data-asset-status', 'loaded');
    await page.waitForFunction((preset) => window.__ASSET_PREVIEW__?.preset === preset
      && window.__ASSET_PREVIEW__.light === 'neutral' && !!window.__ASSET_PREVIEW__.models['city-runner'], preset);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await page.locator('.asset-viewport').screenshot({ path: `artifacts/visual-actual/character-${preset}.png` });
    await expect(page.locator('.asset-viewport')).toHaveScreenshot(`character-${preset}.png`, { animations: 'disabled', threshold: .22, maxDiffPixelRatio: .003 });
    expect(errors).toEqual([]);
  });
}
