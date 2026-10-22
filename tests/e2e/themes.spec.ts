import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_POWERUP_PICKUPS } from '../../src/game/powerups';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';
const generated = JSON.parse(readFileSync(new URL('../../src/assets/generated/manifest.json', import.meta.url), 'utf8'));

// Preserve Task 5's environment budget and account separately for replacing its
// 13 primitive body boxes (156 triangles) with the real character asset. Task11
// measures/subtracts only actually submitted power-up triangles, enforcing a separate
// finite pickup/shell bound while preserving the original environment cap.
const characterAsset = generated.assets['city-runner'];
const replacedBodyTriangles = 156;
const sceneTriangleBudget = 30000 + characterAsset.triangles - replacedBodyTriangles;

test('real running crosses a theme boundary, interpolates continuously, and restart restores Dusk', async ({ page }) => {
  const errors: string[] = [];
  const requests = new Map<string, number>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.endsWith('.glb')) return;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (!response.ok()) errors.push(`${path}: ${response.status()}`);
  });
  await page.goto('/?debugCity=1');
  await waitForThemeAssets(page);
  const dusk = await captureThemeAt(page, 590);
  expect(dusk.themeId).toBe('dusk-city');
  expect(dusk.chunkThemes.some((chunk) => chunk.themeId === 'neon-city')).toBe(true);
  // Already in the safe lane for the next obstacle; this crossing uses the real RAF, not seek.
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0), { intervals: [30] }).toBeGreaterThan(605);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await expect.poll(() => page.evaluate(() => window.__CITY_RENDER__?.themeId)).toBe('neon-city');
  const samples = [];
  for (const distance of [615, 630, 645, 660, 780, 1200, 1230, 1260]) {
    const stats = await captureThemeAt(page, distance, true);
    samples.push(stats);
    expect(stats.chunkIds).toHaveLength(9);
    expect(stats.props).toBeLessThanOrEqual(18);
    expect(stats.calls).toBeLessThan(200);
    const powerupTriangles = await page.evaluate(() => window.__RUNNER_RENDER__?.powerups.triangles ?? 0);
    expect(powerupTriangles).toBeLessThanOrEqual(MAX_POWERUP_PICKUPS * 308 + 48);
    expect(stats.triangles - powerupTriangles).toBeLessThan(sceneTriangleBudget);
    expect(stats.fallbackBatches).toBe(0);
  }
  expect(samples[0]?.transitionProgress).toBeCloseTo(0.25, 2);
  expect(samples[1]?.transitionProgress).toBeCloseTo(0.5, 2);
  expect(samples[3]?.transitionProgress).toBe(1);
  expect(samples[0]?.environment.background).not.toBe(samples[1]?.environment.background);
  expect(samples[1]?.environment.background).not.toBe(samples[3]?.environment.background);
  expect(samples[0]?.environment.road).not.toBe(samples[3]?.environment.road);
  expect(samples[5]?.themeId).toBe('dusk-city');
  expect(samples[7]?.transitionProgress).toBe(1);
  await page.getByRole('button', { name: '暂停游戏' }).click();
  await page.getByRole('button', { name: '从头开始' }).click();
  await expect.poll(() => page.evaluate(() => window.__CITY_RENDER__?.zoneId)).toBe(0);
  expect(await page.evaluate(() => window.__CITY_RENDER__?.themeId)).toBe('dusk-city');
  for (const count of requests.values()) expect(count).toBe(1);
  const added = [...requests.keys()].filter(path => /\/powerup-(magnet|shield|double-score)\.glb$/.test(path));
  expect(requests.size - added.length).toBe(11); // Preserve nine city + roadblock + character requests.
  expect(added.length).toBeLessThanOrEqual(3); // Only the new registered pickups may add requests.
  expect(errors).toEqual([]);
});

test('theme preview reuses the asset viewer and isolates gameplay/debug URL parameters', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?themePreview=neon-city&debugCity=1&testMode=1&distance=590');
  await expect(page.getByRole('heading', { name: 'Neon City 主题预览。' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}).length)).toBe(4);
  const preview = await page.evaluate(() => window.__ASSET_PREVIEW__);
  expect(Object.keys(preview?.models ?? {}).sort()).toEqual(['neon-billboard', 'neon-building-01', 'neon-building-02', 'neon-street-lamp']);
  expect(Object.values(preview?.models ?? {}).every((value) => value.emissiveMaterials > 0)).toBe(true);
  await expect(page.getByTestId('preview-calls')).not.toHaveText('0');
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__CITY_RENDER__' in window)).toBe(false);
  await expect(page.getByLabel('城市调试信息')).toHaveCount(0);
  await page.getByRole('link', { name: 'Dusk City', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dusk City 主题预览。' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__ASSET_PREVIEW__?.models ?? {}).length)).toBe(5);
  await page.goto('/?themePreview=invalid-theme');
  await expect(page.getByRole('alert')).toContainText('未知城市主题');
  expect(errors).toEqual([]);
});

test('development distance URL freezes at the requested boundary and can resume through real input', async ({ page }) => {
  await page.goto('/?testMode=1&distance=590&debugCity=1');
  await waitForThemeAssets(page);
  await expect(page.getByRole('button', { name: '继续演示', exact: true })).toBeVisible();
  const distance = await page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0);
  expect(distance).toBeGreaterThanOrEqual(590); expect(distance).toBeLessThan(590.21);
  await page.getByRole('button', { name: '继续演示', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0), { intervals: [30] }).toBeGreaterThan(602);
  await page.getByRole('button', { name: '冻结画面', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__CITY_RENDER__?.themeId)).toBe('neon-city');
  await page.goto('/?testMode=1&distance=not-a-number');
  await expect(page.getByText('开发定位演示 · 距离无效（0～10000m）')).toBeVisible();
  await page.waitForFunction(() => !!window.__RUNNER_TEST__);
  expect(await page.evaluate(() => ({ status: window.__RUNNER_TEST__?.read().status, distance: window.__RUNNER_TEST__?.read().distance }))).toEqual({ status: 'ready', distance: 0 });
});

test('theme performance measures steady completed scenes and repeated rendered chunk crossings', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?debugCity=1');
  await page.bringToFront();
  await waitForThemeAssets(page);
  const cdp = await context.newCDPSession(page);
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
  });
  const samples = [];
  const started = new Date().toISOString();
  const sampleFrames = () => page.evaluate(() => new Promise<{ frames: number; medianMs: number; p95Ms: number; fps: number; durationMs: number }>((resolve) => {
      const times: number[] = [];
      let previous = 0;
      function frame(now: number) {
        if (previous) times.push(now - previous);
        previous = now;
        if (times.length < 90) { requestAnimationFrame(frame); return; }
        const sorted = [...times].sort((a, b) => a - b);
        const durationMs = times.reduce((sum, value) => sum + value, 0);
        resolve({ frames: times.length, medianMs: sorted[45] ?? 0, p95Ms: sorted[85] ?? 0, fps: 1000 * times.length / durationMs, durationMs });
      }
      requestAnimationFrame(frame);
    }));
  for (const [label, distance] of [['dusk', 95], ['transition', 630], ['neon', 780], ['after-return', 1290]] as const) {
    await captureThemeAt(page, distance);
    const frames = await sampleFrames();
    const forcedGc = await cdp.send('HeapProfiler.collectGarbage').then(() => true, () => false);
    const heap = await cdp.send('Runtime.getHeapUsage').then((result) => ({ usedBytes: result.usedSize, totalBytes: result.totalSize, forcedGc }), () => null);
    const stats = await page.evaluate(() => window.__CITY_RENDER__);
    expect(stats?.calls).toBeLessThan(200);
    const powerupTriangles = await page.evaluate(() => window.__RUNNER_RENDER__?.powerups.triangles ?? 0);
    expect(powerupTriangles).toBeLessThanOrEqual(MAX_POWERUP_PICKUPS * 308 + 48);
    expect((stats?.triangles ?? Infinity) - powerupTriangles).toBeLessThan(sceneTriangleBudget);
    const character = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
    expect(character).toMatchObject({ models: 1, fallbacks: 0, visible: 1, triangles: characterAsset.triangles });
    await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/screenshots/theme-${label}-debug.png` });
    const start = await page.evaluate(() => {
      const hooks = window.__RUNNER_TEST__;
      if (!hooks) throw new Error('Autopilot hook missing');
      const state = hooks.read();
      const result = { distance: state.distance, tick: state.tick };
      hooks.autopilot(true);
      return result;
    });
    const activeFrames = await sampleFrames();
    const end = await page.evaluate(() => {
      const hooks = window.__RUNNER_TEST__;
      if (!hooks) throw new Error('Autopilot hook missing');
      hooks.freeze(true); hooks.autopilot(false);
      const state = hooks.read();
      return { distance: state.distance, tick: state.tick, status: state.status };
    });
    expect(end.tick).toBeGreaterThan(start.tick + 100);
    expect(end.status).toBe('running');
    await page.waitForFunction((distance) => window.__CITY_RENDER__?.distance === distance, end.distance);
    const activeStats = await page.evaluate(() => window.__CITY_RENDER__);
    expect(activeStats?.calls).toBeLessThan(200);
    // Active progression adds/removes seeded coin/hazard rows; record its separate live budget.
    expect(activeStats?.triangles).toBeLessThan(35000);
    const activeCharacter = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
    samples.push({ label, stats, character, frames, heap, active: { start, end, frames: activeFrames, stats: activeStats, character: activeCharacter } });
  }
  // Commit and render every next chunk; unlike a single synchronous 10km seek this exercises GPU updates.
  await captureThemeAt(page, 510);
  const crossings = [];
  for (let distance = 540; distance <= 930; distance += 30) crossings.push(await captureThemeAt(page, distance, true));
  expect(crossings.every((stats) => stats.chunkIds.length === 9 && stats.geometries < 240)).toBe(true);
  const longDistance = await captureThemeAt(page, 10000);
  const reset = await captureThemeAt(page, 95);
  expect(reset.geometries).toBeLessThan(220);
  writeFileSync('artifacts/ui-ux/regression/feel-scene-performance.json', JSON.stringify({ started, finished: new Date().toISOString(), browser: 'Playwright Chromium', viewport: { width: 1440, height: 1000 }, gpu, characterAsset, replacedBody: { meshes: 13, triangles: replacedBodyTriangles }, sceneTriangleBudget, samples, crossings, longDistance, reset, errors }, null, 2));
  expect(errors).toEqual([]);
});
