import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const metadata: { version: string; buildId: string; environment: string } = JSON.parse(readFileSync('dist/release.json', 'utf8'));

test('release HTML metadata revalidates, GLB paths are immutable and missing models stay real 404s', async ({ request, baseURL }) => {
  const html = await request.get(new URL('index.html', baseURL).href);
  const version = await request.get(new URL('release.json', baseURL).href);
  for (const response of [html, version]) {
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toMatch(/no-store|no-cache|max-age=0(?:\D|$)/);
  }
  const glb = await request.get(new URL('models/generated/roadblock.glb', baseURL).href);
  expect(glb.ok()).toBe(true);
  expect(glb.headers()['content-type']).toMatch(/model\/gltf-binary|application\/octet-stream/);
  expect(glb.headers()['cache-control']).toMatch(/max-age=[1-9]\d*/);
  const missing = await request.get(new URL('models/generated/does-not-exist-task14.glb', baseURL).href);
  expect(missing.status()).toBe(404);
});

test('immutable nested release loads exact version, GLBs, real run/settlement/retry and persists profile', async ({ page, baseURL }) => {
  const errors: string[] = [], glbs = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(new URL(request.url()).pathname));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('.glb')) { expect(response.ok()).toBe(true); expect(url.pathname.startsWith(new URL(baseURL ?? '').pathname)).toBe(true); glbs.add(url.pathname); }
  });
  await page.goto('./');
  await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'loaded');
  const remote = await page.request.get(new URL('release.json', baseURL).href);
  expect(remote.ok()).toBe(true); expect(await remote.json()).toMatchObject(metadata);
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__PRODUCT_LIFECYCLE__' in window)).toBe(false);
  await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  await expect.poll(async () => Number((await page.getByTestId('distance').innerText()).replaceAll(',', ''))).toBeGreaterThan(15);
  await expect.poll(async () => Number(await page.getByTestId('coins').innerText())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '更多游戏设置', exact: true }).click();
  await page.getByLabel('画质', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: '再跑一次', exact: true })).toBeVisible({ timeout: 15000 });
  const coins = await page.getByTestId('coins').innerText();
  await expect(page.getByTestId('wallet')).toHaveText(coins);
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '升级商店', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回结算', exact: true }).click();
  await page.getByRole('button', { name: '再跑一次', exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(1);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '确认退出', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '成长任务', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('wallet')).toHaveText(coins);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect([...glbs].some(path => path.endsWith('/roadblock.glb'))).toBe(true);
  expect([...glbs].some(path => path.endsWith('/city-runner.glb'))).toBe(true);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`immutable release supports mobile layout ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');
    await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
    await expect.poll(async () => Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(1);
    await page.getByRole('button', { name: '游戏设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '游戏设置', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
