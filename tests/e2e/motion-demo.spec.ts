import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { waitForThemeAssets } from './theme-helpers';
import { MOTION_DEMO_SEED as seed, MOTION_INPUTS as schedule, stepMotionTo } from './motion-helpers';

// Preserve the archived Task8 final evidence during subsequent feature regressions.
const stage = process.env.MOTION_CAPTURE_STAGE ?? 'task9-regression';
const dir = `artifacts/motion-iteration/${stage}`;
// Verified in the unchanged GameEngine: this route survives all 960 ticks.

test('fixed seed and tick inputs produce an eight second real rendered motion sequence', async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync(`${dir}/frames`, { recursive: true });
  const errors: string[] = [];
  const frames = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/'); await waitForThemeAssets(page);
  await page.evaluate((seed) => window.__RUNNER_TEST__?.captureAt(seed, 0), seed);
  for (let frame = 0; frame <= 120; frame++) {
    const target = frame * 8;
    await stepMotionTo(page, target);
    const value = await page.evaluate(() => {
      const s = window.__RUNNER_TEST__?.read();
      return { tick: s?.tick, distance: s?.distance, speed: s?.speed, status: s?.status, player: s?.player, render: window.__RUNNER_RENDER__ };
    });
    expect(value.status).toBe('running'); expect(value.tick).toBe(target);
    expect(value.render?.character.models).toBe(1); expect(value.render?.character.animation?.actionCount).toBe(4);
    expect(value.render?.character.soles?.left).toBeGreaterThan(-.0031); expect(value.render?.character.soles?.right).toBeGreaterThan(-.0031);
    expect(value.render?.character.position[1]).toBe(value.player?.y); expect(value.render?.character.bankLift).toBeLessThan(.065);
    const render = value.render; if (!render) throw new Error('Actual completed render required');
    for (const coordinates of [render.camera.position, render.camera.quaternion, render.character.position, render.character.scale, ...Object.values(render.character.bones)]) expect(coordinates.every(Number.isFinite)).toBe(true);
    expect(render.camera.fov).toBeGreaterThanOrEqual(51); expect(render.camera.fov).toBeLessThanOrEqual(55);
    for (const scale of render.character.scale) { expect(scale).toBeGreaterThan(.977); expect(scale).toBeLessThan(1.012); }
    await page.locator('.game-stage').screenshot({ path: `${dir}/frames/${String(frame).padStart(3, '0')}.png` });
    frames.push(value);
  }
  for (const [name, frame] of [['normal-run', 8], ['lean-left', 31], ['lean-right', 46], ['takeoff', 61], ['air', 67], ['landing', 75], ['slide', 93], ['recovered', 119]] as const) copyFileSync(`${dir}/frames/${String(frame).padStart(3, '0')}.png`, `${dir}/${name}.png`);
  await page.evaluate((seed) => window.__RUNNER_TEST__?.captureAt(seed, 10000), seed);
  await page.waitForFunction(() => (window.__RUNNER_TEST__?.read().distance ?? 0) >= 10000 && window.__RUNNER_RENDER__?.character.animation?.state === 'run');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator('.game-stage').screenshot({ path: `${dir}/fast-run.png` });
  const fast = await page.evaluate(() => ({ player: window.__RUNNER_TEST__?.read().player, speed: window.__RUNNER_TEST__?.read().speed, render: window.__RUNNER_RENDER__ }));
  writeFileSync(`${dir}/motion-data.json`, JSON.stringify({ stage, seed, viewport: { width: 1440, height: 1000 }, fixedDt: 1 / 120, framesPerSecond: 15, simulationSeconds: 8, schedule, source: 'actual GameEngine fixed ticks and actual Three.js rendered frames; no injected physics state', frames, fast, errors }, null, 2));
  expect(frames.some((frame) => frame.render?.character.animation?.state === 'jump')).toBe(true);
  expect(frames.some((frame) => frame.render?.character.animation?.state === 'slide')).toBe(true);
  expect(new Set(frames.map((frame) => frame.render?.character.animation?.mixerId)).size).toBe(1);
  expect(errors).toEqual([]);
});

test('records eight seconds of unpaused real input playback separately from fixed-frame captures', async ({ browser }) => {
  mkdirSync(`${dir}/unpaused`, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: `${dir}/unpaused`, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(); const errors: string[] = []; const inputs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5174/'); await waitForThemeAssets(page);
  await page.evaluate((seed) => window.__RUNNER_TEST__?.captureAt(seed, 0), seed);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.tick === 0);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  for (const [requestedTick, key] of schedule) {
    await page.waitForFunction((tick) => (window.__RUNNER_TEST__?.read().tick ?? 0) >= tick, requestedTick);
    await page.keyboard.press(key);
    inputs.push(await page.evaluate(({ requestedTick, key }) => ({ requestedTick, key, deliveredAtTick: window.__RUNNER_TEST__?.read().tick, render: window.__RUNNER_RENDER__ }), { requestedTick, key }));
  }
  await page.waitForFunction(() => (window.__RUNNER_TEST__?.read().tick ?? 0) >= 960);
  const end = await page.evaluate(() => ({ tick: window.__RUNNER_TEST__?.read().tick, status: window.__RUNNER_TEST__?.read().status, render: window.__RUNNER_RENDER__ }));
  expect(end.status).toBe('running'); expect(end.render?.character.animation?.state).toBe('run');
  const video = page.video(); await context.close(); if (!video) throw new Error('Actual unpaused video unavailable');
  copyFileSync(await video.path(), `${dir}/unpaused-motion.webm`);
  writeFileSync(`${dir}/unpaused-inputs.json`, JSON.stringify({ seed, source: 'real unpaused RAF and Playwright keyboard input; actual delivery ticks recorded; exact deterministic replay is the separate 121-frame sequence', inputs, end, errors }, null, 2));
  expect(errors).toEqual([]);
});
