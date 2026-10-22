import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startProgression, seekPower, playTo, endRun, breakShield } from './progression-helpers';
import { settleFeedback } from './feel-helpers';
const cases = ['magnet-pickup', 'magnet-active', 'shield-pickup', 'shield-active', 'shield-broken', 'double-pickup', 'double-hud', 'shop', 'upgrade-success', 'missions', 'mission-completed', 'settlement', 'mobile-shop', 'mobile-missions'] as const;
for (const name of cases) test(`progression visual ${name}`, async ({ page }) => {
  test.setTimeout(60000);
  const mobile = name.startsWith('mobile'); if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await startProgression(page);
  if (/^(magnet|shield|double)/.test(name)) {
    const type = name.startsWith('magnet') ? 'magnet' : name.startsWith('shield') ? 'shield' : 'double-score';
    const distance = await seekPower(page, type);
    await playTo(page, distance + (name.endsWith('pickup') ? -4 : 1));
    if (name === 'shield-broken') await breakShield(page);
  } else if (['shop', 'missions', 'mobile-shop', 'mobile-missions'].includes(name)) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: name.endsWith('shop') ? '升级商店' : '任务', exact: true }).click();
  } else {
    await playTo(page, 1100); await endRun(page);
    if (name === 'mission-completed') await page.getByRole('button', { name: '任务', exact: false }).click();
    if (name === 'upgrade-success') {
      await page.getByRole('button', { name: '升级商店', exact: true }).click();
      await page.getByRole('button', { name: '升级磁铁', exact: true }).click();
      await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
    }
  }
  await settleFeedback(page); await page.evaluate(() => document.fonts.ready);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const b = await dialog.boundingBox(); expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(mobile ? 390 : 1440);
    for (const button of await dialog.getByRole('button').all()) {
      const box = await button.boundingBox(); if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  mkdirSync('artifacts/ui-ux/regression/progression/visual-actual', { recursive: true });
  // Native dialogs live in the browser top layer, so capture viewport including the real 3D background.
  await page.screenshot({ path: `artifacts/ui-ux/regression/progression/visual-actual/${name}.png`, animations: 'disabled' });
  await expect(page).toHaveScreenshot(`progression-${name}.png`, { animations: 'disabled', maxDiffPixelRatio: .003 });
});
