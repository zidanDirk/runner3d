import { requestGameScene, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

async function loadedCity(page: Page, chunk = 0) {
  await requestGameScene(page);
  await expect.poll(() => page.evaluate(() => {
    const value = window.__CITY_RENDER__;
    return value && value.fallbackBatches === 0 && value.batches === value.expectedBatches ? value.currentChunk : -1;
  })).toBe(chunk);
  const city = await page.evaluate(() => window.__CITY_RENDER__);
  if (!city) throw new Error('City diagnostics missing');
  return city;
}

test('city GLBs appear on both sides, update during real play and reset without duplicate loading', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    if (/\/(street-lamp|city-building-0[12])\.glb$/.test(new URL(response.url()).pathname)) {
      requests.push(new URL(response.url()).pathname);
      if (!response.ok()) errors.push(`HTTP ${response.status()}`);
    }
  });
  await page.goto('/');
  const initial = await loadedCity(page);
  expect(initial.chunkIds).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6]);
  expect(initial.buildings).toBeGreaterThan(20);
  expect(initial.lamps).toBe(36);
  for (const sides of Object.entries(initial.visibleBySide).filter(([id]) => (initial.renderedInstances[id] ?? 0) > 0).map(([, sides]) => sides)) {
    expect(sides[0]).toBeGreaterThan(0); expect(sides[1]).toBeGreaterThan(0);
  }
  expect(Object.values(initial.renderedInstances).reduce((sum, value) => sum + value, 0) + initial.culledInstances).toBe(initial.buildings + initial.lamps + initial.props);
  await startLiveGame(page);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().player.lane)).toBe(0);
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().player.lane)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0)).toBeGreaterThan(34);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().coins)).toBeGreaterThan(0);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  const after = await loadedCity(page, 1);
  expect(after.chunkIds).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
  expect(after.revision).toBeGreaterThan(initial.revision);
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/city-gameplay.png' });
  // Deliberately hit the existing seeded roadblock through real keyboard input.
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 12000 });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().hit)).toBe('hurdle');
  await page.getByRole('button', { name: '再跑一次' }).click();
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  const reset = await loadedCity(page);
  expect(reset.chunkIds).toEqual(initial.chunkIds);
  expect(reset.buildings).toBe(initial.buildings);
  expect(requests.sort()).toEqual(['/models/generated/city-building-01.glb', '/models/generated/city-building-02.glb', '/models/generated/street-lamp.glb']);
  expect(errors).toEqual([]);
});

test('debug city supports stable captures and bounded resources through a real 10km engine seek', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?debugCity=1');
  const initial = await loadedCity(page);
  const samples = [];
  for (const distance of [95, 960, 10000, 0, 95]) {
    const applied = await page.evaluate((distance) => window.__RUNNER_TEST__?.captureAt('RUNNER-01', distance), distance);
    expect(applied?.chunk).toBe(Math.floor(distance / 30));
    const sample = await loadedCity(page, Math.floor(distance / 30));
    expect(sample.chunkIds).toHaveLength(9);
    expect(sample.buildings).toBeLessThanOrEqual(54);
    expect(sample.lamps).toBe(36);
    expect(sample.calls).toBeLessThan(200);
    expect(sample.triangles).toBeLessThan(50000);
    // Entity geometry is recycled asynchronously by R3F; it must settle below the existing budget.
    await expect.poll(() => page.evaluate(() => window.__CITY_RENDER__?.geometries ?? 1000)).toBeLessThan(200);
    samples.push(sample);
  }
  await expect(page.getByLabel('城市调试信息')).toContainText('Chunk 3');
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/city-debug.png' });
  const final = await loadedCity(page, 3);
  expect(final.geometries).toBeLessThanOrEqual(initial.geometries + 50);
  writeFileSync('artifacts/ui-ux/regression/city-render-metrics.json', JSON.stringify({ viewport: { width: 1440, height: 1000 }, initial, samples, final }, null, 2));
  expect(errors).toEqual([]);
});

test('city GLB failure uses bounded instanced fallbacks without breaking gameplay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route((url) => url.pathname.endsWith('/city-building-01.glb'), (route) => route.abort('failed'));
  await page.goto('/');
  await requestGameScene(page);
  await expect.poll(() => page.evaluate(() => window.__CITY_RENDER__?.fallbackBatches ?? 0)).toBe(1);
  await page.getByRole('button', { name: '使用基础模型继续', exact: true }).click();
  await startLiveGame(page);
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.filter((error) => !/^Could not load \/models\/generated\/city-building-01\.glb\?v=[a-f0-9]{64}: Failed to fetch$/.test(error))).toEqual([]);
});
