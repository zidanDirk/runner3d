import { expect, test } from '@playwright/test';
import { MOTION_CASES, applyMotionCase } from './motion-helpers';

for (const name of MOTION_CASES) test(`visual motion ${name}`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/'); await applyMotionCase(page, name);
  await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/visual-actual/motion-${name}.png` });
  await expect(page.locator('.game-stage')).toHaveScreenshot(`motion-${name}.png`, { animations: 'disabled', threshold: .22, maxDiffPixelRatio: .003 });
  expect(errors).toEqual([]);
});
