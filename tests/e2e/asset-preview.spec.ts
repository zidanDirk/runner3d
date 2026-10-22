import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const generated: { assets: Record<string, { dimensions: number[]; materials: string[]; triangles: number }> } = JSON.parse(readFileSync(new URL('../../src/assets/generated/manifest.json', import.meta.url), 'utf8'));

test('asset preview loads every actual GLB, exposes measured stats, rotates and returns to the game', async ({ page }) => {
  const errors: string[] = [];
  const requests = new Map<string, number>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`));
  page.on('response', (response) => {
    const id = new URL(response.url()).pathname.match(/\/models\/generated\/([^/]+)\.glb$/)?.[1];
    if (!id) return;
    requests.set(id, (requests.get(id) ?? 0) + 1);
    if (!response.ok()) errors.push(`GLB ${id}: ${response.status()}`);
  });
  await page.goto('/?assetPreview=1&debugCity=1');
  await expect(page.getByRole('heading', { name: '城市资产工厂。' })).toBeVisible();
  const ids = Object.keys(generated.assets);
  await expect.poll(async () => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}).length)).toBe(ids.length);
  expect(await page.evaluate(() => window.__RUNNER_TEST__)).toBeUndefined();
  expect(await page.evaluate(() => window.__CITY_RENDER__)).toBeUndefined();
  await expect(page.getByLabel('城市调试信息')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/asset-factory-overview.png' });
  for (const id of ids) {
    const expected = generated.assets[id];
    if (!expected) throw new Error(`Missing manifest entry ${id}`);
    await page.getByRole('button', { name: `查看 ${id}`, exact: true }).click();
    await expect.poll(async () => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}))).toEqual([id]);
    await expect(page.getByRole('button', { name: `查看 ${id}`, exact: true })).toHaveAttribute('data-asset-status', 'loaded');
    const actual = await page.evaluate((key) => window.__ASSET_PREVIEW__?.models[key], id);
    expect(actual?.minY).toBeCloseTo(0, 4);
    expected.dimensions.forEach((value, axis) => expect(actual?.size[axis]).toBeCloseTo(value, 4));
    expect(actual?.materials).toEqual([...expected.materials].sort());
    await expect(page.getByTestId('asset-triangles')).toHaveText(expected.triangles.toLocaleString('en-US'));
    if (id === 'street-lamp') expect(actual?.emissiveMaterials).toBeGreaterThan(0);
    await page.locator('.asset-viewport').screenshot({ path: `artifacts/ui-ux/regression/screenshots/asset-${id}.png` });
  }
  const camera = await page.evaluate(() => window.__ASSET_PREVIEW__?.camera);
  const box = await page.locator('.asset-viewport canvas').boundingBox();
  if (!box) throw new Error('Missing actual preview canvas');
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__ASSET_PREVIEW__?.camera)).not.toEqual(camera);
  await page.getByRole('button', { name: '重置视角 ↻' }).click();
  await expect.poll(async () => page.evaluate(() => window.__ASSET_PREVIEW__?.camera)).toEqual(camera);
  await page.getByRole('button', { name: '预加载全部' }).click();
  for (const id of ids) expect(requests.get(id)).toBe(1);
  expect(errors).toEqual([]);
  await page.getByRole('link', { name: '返回游戏 ↗' }).click();
  await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeVisible();
});

test('preview remains usable if one model fails and fits a narrow screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route((url) => url.pathname.endsWith('/models/generated/traffic-cone.glb'), (route) => route.abort('failed'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?assetPreview=1');
  await expect(page.getByRole('button', { name: '查看 traffic-cone', exact: true })).toHaveAttribute('data-asset-status', 'error');
  await page.getByRole('button', { name: '查看 traffic-cone', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看 traffic-cone', exact: true })).toHaveAttribute('data-asset-status', 'error');
  await page.getByRole('button', { name: '查看 street-lamp', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}))).toEqual(['street-lamp']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/asset-factory-mobile.png', fullPage: true });
  expect(errors.filter((message) => !/^Could not load \/models\/generated\/traffic-cone\.glb\?v=[a-f0-9]{64}: Failed to fetch$/.test(message))).toEqual([]);
});
