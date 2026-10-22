import { expect, test } from '@playwright/test';
import { LevelGenerator } from '../../src/game/level';
test('production loads all three real power-up GLBs and completes a normal run, wallet and shop', async ({ page }) => {
  test.setTimeout(45000); const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { const p = new URL(r.url()).pathname; if (/powerup-(magnet|shield|double-score)\.glb$/.test(p)) { expect(r.ok()).toBe(true); requests.push(p); } });
  const level = new LevelGenerator('DEMO-11-4411'), rows = Array.from({ length: 25 }, () => level.next());
  await page.goto('/'); await page.locator('.route-details > summary').click(); await page.getByLabel('路线 Seed').fill('DEMO-11-4411'); await page.getByRole('button', { name: '应用路线', exact: true }).click();
  await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停游戏', exact: true })).toBeVisible();
  let lane = 1, captured = false; const start = Date.now();
  while (Date.now() - start < 33000 && !await page.getByRole('button', { name: '再跑一次', exact: true }).isVisible()) {
    const distance = Number((await page.getByTestId('distance').innerText()).replaceAll(',', ''));
    if (distance > 266 && !captured) {
      for (const type of ['magnet', 'shield', 'double-score']) await expect(page.getByTestId(`active-${type}`)).toBeVisible();
      await page.screenshot({ path: 'artifacts/ui-ux/regression/progression/production-active.png' }); captured = true;
    }
    const target = distance > 280 ? rows.flatMap(r => r.entities).find(e => e.kind !== 'coin' && e.distance > distance + 9)?.lane : rows.find(r => r.distance >= distance - 9)?.safeLane;
    if (target !== undefined && lane !== target) { await page.keyboard.press(target < lane ? 'ArrowLeft' : 'ArrowRight'); lane += target < lane ? -1 : 1; }
    await page.waitForTimeout(75);
  }
  await expect(page.getByRole('button', { name: '再跑一次', exact: true })).toBeVisible(); expect(captured).toBe(true);
  const coins = await page.getByTestId('coins').innerText(); await expect(page.getByTestId('wallet')).toHaveText(coins);
  expect(new Set(requests).size).toBe(3); for (const path of new Set(requests)) expect(requests.filter(p => p === path)).toHaveLength(1);
  await page.getByRole('button', { name: '升级商店', exact: true }).click(); await expect(page.getByRole('button', { name: '升级磁铁', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__RUNNER_RENDER__' in window)).toBe(false); expect(errors).toEqual([]);
});
