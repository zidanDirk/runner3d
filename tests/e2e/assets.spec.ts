import { requestGameScene, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';

test('Blender roadblock loads with correct materials/bounds, appears, collides and retries', async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  let modelResponses = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/models/generated/roadblock.glb')) {
      if (response.ok()) modelResponses++;
      else errors.push(`GLB response: ${response.status()}`);
    }
  });
  await page.goto('/');
  await requestGameScene(page);
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_RENDER__?.roadblock.models ?? 0)).toBeGreaterThan(0);
  const asset = await page.evaluate(() => window.__RUNNER_RENDER__?.roadblock);
  expect(asset?.visible).toBeGreaterThan(0);
  expect(asset?.fallbacks).toBe(0);
  expect(asset?.bounds?.minY).toBeCloseTo(0, 4);
  expect(asset?.bounds?.size[0]).toBeCloseTo(2, 4);
  expect(asset?.bounds?.size[1]).toBeCloseTo(0.85, 4);
  expect(asset?.bounds?.size[2]).toBeCloseTo(0.9, 4);
  expect(asset?.bounds?.materials).toEqual(['roadblock_base', 'roadblock_orange', 'roadblock_white']);
  expect(modelResponses).toBe(1); // Shared loader cache across obstacle instances.
  const initial = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  const hurdle = initial?.entities.find((entity) => entity.kind === 'hurdle');
  if (!initial || !hurdle) throw new Error('Expected hurdle in deterministic RUNNER-01 route');
  await startLiveGame(page);
  for (let lane = 1; lane > hurdle.lane; lane--) await page.keyboard.press('ArrowLeft');
  for (let lane = 1; lane < hurdle.lane; lane++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_TEST__?.read().player.lane)).toBe(hurdle.lane);
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0), { intervals: [30] }).toBeGreaterThan(hurdle.distance - 10);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '稍作停留。' })).toBeVisible();
  // Freeze through the real pause control; hide only the pause card for an unobstructed asset capture.
  await page.locator('.pause-menu').evaluate((element) => { element.style.visibility = 'hidden'; });
  await page.locator('.game-stage').screenshot({ path: 'artifacts/screenshots/roadblock-gameplay.png' });
  await page.locator('.pause-menu').evaluate((element) => { element.style.visibility = ''; });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 12000 });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().hit)).toBe('hurdle');
  await page.getByRole('button', { name: '再跑一次' }).click();
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 100)).toBeLessThan(5);
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_RENDER__?.roadblock.models ?? 0)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('a failed GLB request keeps the primitive fallback playable with unchanged collisions', async ({ page }) => {
  const unhandled: string[] = [];
  page.on('pageerror', (error) => unhandled.push(error.message));
  await page.route((url) => url.pathname.endsWith('/models/generated/roadblock.glb'), (route) => route.abort('failed'));
  await page.goto('/');
  await requestGameScene(page);
  // R3F 9 reports even boundary-caught errors through reportError. Require the injected
  // failure to have happened, and reject every error except this exact expected request.
  await expect.poll(() => unhandled.length).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_RENDER__?.roadblock.fallbacks ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.roadblock.models)).toBe(0);
  await page.getByRole('button', { name: '使用基础模型继续', exact: true }).click();
  await startLiveGame(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0)).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 12000 });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().hit)).toBe('hurdle');
  await page.getByRole('button', { name: '再跑一次' }).click();
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(unhandled.filter((error) => !/^Could not load \/models\/generated\/roadblock\.glb\?v=[a-f0-9]{64}: Failed to fetch$/.test(error))).toEqual([]);
});
