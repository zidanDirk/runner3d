import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

test('production strips balance diagnostics and ignores balance-looking URL mutations', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debugBalance=1&testMode=1&distance=9000&walletCoins=999999&magnet=3&shield=3&profile=expert');
  await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeEnabled();
  await expect(page.getByLabel('游戏平衡调试信息')).toHaveCount(0);
  await expect(page.locator('.home-screen')).toBeVisible(); await expect(page.getByTestId('distance')).toHaveCount(0); await expect(page.getByTestId('wallet')).toHaveText('0');
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__RUNNER_RENDER__' in window || '__BALANCE__' in window)).toBe(false);
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.0 / 3');
  for (const file of readdirSync('dist/assets').filter(file => file.endsWith('.js'))) {
    const source = readFileSync(`dist/assets/${file}`, 'utf8');
    expect(source).not.toContain('游戏平衡调试信息'); expect(source).not.toContain('最近生成证书'); expect(source).not.toContain('balance-debug');
  }
  expect(errors).toEqual([]);
});
