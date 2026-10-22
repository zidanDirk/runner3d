import { requestGameScene, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const asset = JSON.parse(readFileSync(new URL('../../src/assets/generated/manifest.json', import.meta.url), 'utf8')).assets['city-runner'];
const round = process.env.ANIMATION_CAPTURE_ROUND ?? 'final';
const out = round === 'final' ? 'artifacts/ui-ux/regression/screenshots' : `artifacts/ui-ux/regression/animation-iteration/${round}`;

test('animation pose captures use actual skin and deterministic clip seconds', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const captures = [];
  const poses = [
    ['idle-front', 'idle', 0, '正面', false],
    ['run-left-contact', 'run', 0, '左侧', false],
    ['run-right-contact', 'run', .36, '左侧', false],
    ['run-passing', 'run', .18, '45°', false],
    ['run-front', 'run', .18, '正面', false],
    ['run-back', 'run', .54, '背面', false],
    ['jump-takeoff', 'jump', .095, '左侧', false],
    ['jump-air', 'jump', .475, '45°', false],
    ['slide', 'slide', .375, '左侧', false],
    ['skeleton', 'run', .18, '45°', true],
  ] as const;
  for (const [name, animation, seconds, view, skeleton] of poses) {
    await page.goto(`/?characterPreview=city-runner&animation=${animation}&animationTime=${seconds}${skeleton ? '&showSkeleton=1' : ''}`);
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForFunction(({ animation, seconds }) => {
      const stats = window.__ASSET_PREVIEW__;
      return !!stats?.models['city-runner'] && stats.animation?.state === animation && Math.abs(stats.animation.time - seconds) < .001 && stats.animation.paused;
    }, { animation, seconds });
    const stats = await page.evaluate(() => window.__ASSET_PREVIEW__);
    expect(stats?.animation?.actionCount).toBe(4);
    expect(Object.keys(stats?.bones ?? {})).toHaveLength(asset.boneCount);
    expect(stats?.skeletonHelpers).toBe(skeleton ? 1 : 0);
    expect(stats?.models['city-runner']?.materials).toEqual([...asset.materials].sort());
    expect(stats?.models['city-runner']?.minY).toBeGreaterThan(-.035);
    if (animation === 'slide') expect(stats?.models['city-runner']?.size[1]).toBeLessThan(.83);
    if (animation === 'run') {
      const left = stats?.bones.LeftFoot; const right = stats?.bones.RightFoot;
      expect(left).toBeDefined(); expect(right).toBeDefined();
      if (seconds === 0) expect(left?.[2]).toBeLessThan(right?.[2] ?? -Infinity);
      if (seconds === .36) expect(left?.[2]).toBeGreaterThan(right?.[2] ?? Infinity);
    }
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await page.locator('.asset-viewport').screenshot({ path: `${out}/animation-${name}.png` });
    captures.push({ name, animation, seconds, view, stats });
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/animation-pose-evidence.json`, JSON.stringify({ round, asset: { hash: asset.sha256, bones: asset.boneCount, skins: asset.skinCount, clips: asset.animationClips }, captures, errors }, null, 2));
  expect(errors).toEqual([]);
});

test('continuous real gameplay records Run Jump Slide recovery and pause through real input', async ({ browser }) => {
  const { copyFile, mkdir } = await import('node:fs/promises');
  const dir = round === 'final' ? 'artifacts/ui-ux/regression/animation-motion' : `${out}/motion`;
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(); const errors: string[] = [];
  const frames: { name: string; now: number; tick: number | undefined; distance: number | undefined; character: NonNullable<Window['__RUNNER_RENDER__']>['character'] | undefined }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5174/');
  await requestGameScene(page);
  await page.waitForFunction(() => !!window.__RUNNER_RENDER__?.character.animation && !!window.__RUNNER_TEST__);
  await startLiveGame(page);
  // Autopilot only sends ordinary lane intents to stay on the generated safe route.
  await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
  const frame = async (name: string) => {
    await page.locator('.game-stage').screenshot({ path: `${dir}/game-${name}.png` });
    frames.push(await page.evaluate((name) => ({ name, now: performance.now(), tick: window.__RUNNER_TEST__?.read().tick, distance: window.__RUNNER_TEST__?.read().distance, character: window.__RUNNER_RENDER__?.character }), name));
  };
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.weights.run === 1);
  await frame('run-start');
  for (const [key, state] of [['Space', 'jump'], ['s', 'slide']] as const) {
    await page.keyboard.press(key);
    await page.waitForFunction((state) => window.__RUNNER_RENDER__?.character.animation?.state === state, state);
    for (let i = 0; i < 7; i++) {
      await frame(`${state}-${i}`);
      // This is an unpaused RAF sequence. Still-pose regression uses exact seconds elsewhere.
      await page.waitForTimeout(70);
    }
    await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && window.__RUNNER_RENDER__.character.animation.weights.run === 1);
    await frame(`after-${state}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.paused === true);
  const paused = await page.evaluate(() => window.__RUNNER_RENDER__?.character.bones);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.bones)).toEqual(paused);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.paused === false);
  await frame('resumed');
  const video = page.video(); await context.close();
  if (!video) throw new Error('Actual game motion recording unavailable');
  await copyFile(await video.path(), `${dir}/game-run-jump-slide.webm`);
  writeFileSync(`${dir}/game-motion-evidence.json`, JSON.stringify({ source: 'unpaused real fixed-step game with keyboard jump/slide and safe-route lane intents', frames, errors }, null, 2));
  expect(frames.some((frame) => frame.character?.animation?.state === 'jump')).toBe(true);
  expect(frames.some((frame) => frame.character?.animation?.state === 'slide')).toBe(true);
  expect(new Set(frames.map((frame) => frame.character?.animation?.mixerId)).size).toBe(1);
  expect(errors).toEqual([]);
});

test('real gameplay drives animations, freezes on pause, blends back and reuses the mixer on retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(request.url()));
  await page.goto('/');
  await expect(page.locator('[data-model-status="loaded"]')).toBeVisible();
  await expect(page.locator('.home-screen canvas')).toBeVisible();
  // Task13 Idle belongs to the lightweight home preview; game skin checks start after the real launch.
  await requestGameScene(page);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && !!window.__RUNNER_TEST__);
  const first = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
  expect(first?.skinnedMeshes).toBe(asset.skinnedMeshCount); expect(first?.skinCount).toBe(asset.skinCount);
  const mixer = first?.animation?.mixerId;
  await startLiveGame(page);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && window.__RUNNER_RENDER__.character.animation.weights.run === 1);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().player.x ?? 0)).toBeLessThan(-2.7);
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => Math.abs(window.__RUNNER_TEST__?.read().player.x ?? 10))).toBeLessThan(.01);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'jump');
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const jumping = await page.evaluate(() => ({ player: window.__RUNNER_TEST__?.read().player, character: window.__RUNNER_RENDER__?.character }));
  expect(jumping.character?.position[1]).toBeCloseTo(jumping.player?.y ?? -1, 5);
  expect(jumping.character?.bones.Root?.[1]).toBeCloseTo(jumping.player?.y ?? -1, 5);
  const expectedProgress = (10.5 - (jumping.player?.velocityY ?? 10.5)) / 22 / .95;
  expect(jumping.character?.animation?.time).toBeCloseTo(expectedProgress * .95, 3);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.paused === true);
  const paused = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
  await page.evaluate(() => new Promise<void>((resolve) => { let frames = 0; const frame = () => { if (++frames === 12) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); }));
  const held = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
  expect(held?.animation?.time).toBe(paused?.animation?.time); expect(held?.bones).toEqual(paused?.bones);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && window.__RUNNER_RENDER__.character.animation.weights.run === 1);
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'slide');
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  const tick = await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(35).tick);
  await page.waitForFunction((tick) => window.__RUNNER_TEST__?.read().tick === tick && (window.__RUNNER_RENDER__?.character.bounds?.size[1] ?? 2) < .83, tick);
  const sliding = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
  expect(sliding?.animation?.state).toBe('slide'); expect(sliding?.scale[1]).toBe(1);
  expect(sliding?.bounds?.minY).toBeGreaterThan(-.04);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && window.__RUNNER_RENDER__.character.animation.weights.slide === 0);
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0)).toBeGreaterThan(0);
  const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  const obstacle = state?.entities.find((entity) => entity.kind !== 'coin' && entity.distance > state.distance);
  if (!obstacle || !state) throw new Error('Real seeded obstacle required');
  for (let lane = state.player.lane; lane > obstacle.lane; lane--) await page.keyboard.press('ArrowLeft');
  for (let lane = state.player.lane; lane < obstacle.lane; lane++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 14000 });
  const ended = await page.evaluate(() => window.__RUNNER_RENDER__?.character.animation?.time);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.animation?.time)).toBe(ended);
  await page.getByRole('button', { name: '再跑一次' }).click();
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run');
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.animation?.mixerId)).toBe(mixer);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.animation?.actionCount)).toBe(4);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 10000));
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && (window.__RUNNER_TEST__?.read().distance ?? 0) >= 10000);
  const long = await page.evaluate(() => window.__RUNNER_RENDER__?.character.animation);
  expect(long?.mixerId).toBe(mixer); expect(long?.actionCount).toBe(4); expect(Number.isFinite(long?.time)).toBe(true); expect(long?.runScale).toBe(1.5);
  expect(errors).toEqual([]);
});

test('deterministic real inputs capture symmetric lane lean and both city themes', async ({ page }) => {
  const { captureThemeAt, waitForThemeAssets } = await import('./theme-helpers');
  const errors: string[] = []; const captures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/'); await waitForThemeAssets(page);
  const lean = [];
  for (const [name, key] of [['left', 'a'], ['right', 'd']] as const) {
    await captureThemeAt(page, 0);
    await page.keyboard.press(key);
    await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(4));
    await page.waitForFunction(() => (window.__RUNNER_TEST__?.read().tick ?? 0) === 4 && Math.abs(window.__RUNNER_RENDER__?.character.lean ?? 0) > .02);
    const character = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
    lean.push(character?.lean ?? 0);
    await page.locator('.game-stage').screenshot({ path: `${out}/animation-lean-${name}.png` }); captures.push({ name, character });
  }
  expect(lean[0]).toBeCloseTo(-(lean[1] ?? 0), 7);
  for (const [name, distance] of [['dusk', 95], ['transition', 630], ['neon', 780], ['return', 1230]] as const) {
    const city = await captureThemeAt(page, distance);
    const character = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
    expect(character?.animation?.state).toBe('run'); expect(character?.visible).toBe(1); expect(character?.animation?.weights.run).toBe(1);
    await page.locator('.game-stage').screenshot({ path: `${out}/animation-game-${name}.png` }); captures.push({ name, city, character });
  }
  writeFileSync(`${out}/animation-game-evidence.json`, JSON.stringify({ captures, errors }, null, 2));
  expect(errors).toEqual([]);
});

test('preview supports real playback, pause, replay, speed and a continuous motion capture', async ({ browser }) => {
  const { copyFile, mkdir } = await import('node:fs/promises');
  const dir = round === 'final' ? 'artifacts/ui-ux/regression/animation-motion' : `${out}/motion`;
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(); const errors: string[] = []; const frames = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5174/?characterPreview=city-runner&animation=run&animationTime=0');
  await page.getByRole('button', { name: '左侧', exact: true }).click();
  await page.waitForFunction(() => window.__ASSET_PREVIEW__?.animation?.state === 'run');
  await page.getByRole('button', { name: '播放动画', exact: true }).click();
  for (let i = 0; i < 14; i++) {
    const before = await page.evaluate(() => window.__ASSET_PREVIEW__?.animation?.time);
    await page.waitForFunction((before) => !!window.__ASSET_PREVIEW__?.animation && window.__ASSET_PREVIEW__.animation.time !== before, before);
    await page.locator('.asset-viewport').screenshot({ path: `${dir}/run-${String(i).padStart(2, '0')}.png` });
    frames.push(await page.evaluate(() => ({ now: performance.now(), animation: window.__ASSET_PREVIEW__?.animation, bones: window.__ASSET_PREVIEW__?.bones })));
  }
  await page.getByRole('button', { name: '暂停动画', exact: true }).click();
  await page.waitForFunction(() => window.__ASSET_PREVIEW__?.animation?.paused === true);
  const paused = await page.evaluate(() => window.__ASSET_PREVIEW__?.animation?.time);
  await page.evaluate(() => new Promise<void>((resolve) => { let n = 0; const step = () => { if (++n > 16) resolve(); else requestAnimationFrame(step); }; requestAnimationFrame(step); }));
  expect(await page.evaluate(() => window.__ASSET_PREVIEW__?.animation?.time)).toBe(paused);
  await page.getByLabel('动画播放速度').selectOption('1.5');
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await page.waitForFunction(() => window.__ASSET_PREVIEW__?.animation?.paused === false);
  for (const state of ['Jump', 'Slide', 'Run']) {
    await page.getByRole('button', { name: state, exact: true }).click();
    await page.waitForFunction((state) => window.__ASSET_PREVIEW__?.animation?.state === state.toLowerCase(), state);
  }
  const video = page.video(); await context.close();
  if (!video) throw new Error('Actual motion recording unavailable');
  await copyFile(await video.path(), `${dir}/preview-run-and-transitions.webm`);
  writeFileSync(`${dir}/motion-evidence.json`, JSON.stringify({ source: 'unpaused real AnimationMixer playback, not frozen stills', frames, errors }, null, 2));
  expect(new Set(frames.map((frame) => JSON.stringify(frame?.bones))).size).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
