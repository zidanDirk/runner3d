import { expect, test } from '@playwright/test';
import { followPowerupRoute, POWERUP_ROUTE } from './route-journey';
test('production loads all three real power-up GLBs and completes a normal run, wallet and shop', async ({ page }) => {
  test.setTimeout(45000); const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { const p = new URL(r.url()).pathname; if (/powerup-(magnet|shield|double-score)\.glb$/.test(p)) { expect(r.ok()).toBe(true); requests.push(p); } });
  await page.goto('/'); await page.locator('.route-details > summary').click(); await page.getByLabel('路线 Seed').fill(POWERUP_ROUTE); await page.getByRole('button', { name: '应用路线', exact: true }).click();
  await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停游戏', exact: true })).toBeVisible();
  await followPowerupRoute(page, 'artifacts/ui-ux/regression/progression/production-active.png');
  const coins = await page.getByTestId('coins').innerText(); await expect(page.getByTestId('wallet')).toHaveText(coins);
  expect(new Set(requests).size).toBe(3); for (const path of new Set(requests)) expect(requests.filter(p => p === path)).toHaveLength(1);
  await page.getByRole('button', { name: '升级商店', exact: true }).click(); await expect(page.getByRole('button', { name: '升级磁铁', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__RUNNER_RENDER__' in window)).toBe(false); expect(errors).toEqual([]);
});
