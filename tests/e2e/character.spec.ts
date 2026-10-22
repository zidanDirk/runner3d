import { requestGameScene, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { AnimationMixer, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { measureDeformed } from '../../scripts/assets/character-rig-validation.mjs';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

const manifest = JSON.parse(readFileSync(new URL('../../src/assets/generated/manifest.json', import.meta.url), 'utf8'));
const character = manifest.assets['city-runner'];
const round = process.env.CHARACTER_CAPTURE_ROUND ?? 'final';
const out = round === 'final' ? 'artifacts/ui-ux/regression/screenshots' : `artifacts/ui-ux/regression/character-iteration/${round}`;

// Fixed camera/light/viewports; wait for the actual GLB and a completed sampled frame.
test('character preview renders five real views, theme lighting, joints, orbit and zoom', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => { if (new URL(response.url()).pathname.endsWith('city-runner.glb')) { requests.push(response.url()); expect(response.ok()).toBe(true); } });
  await page.goto('/?characterPreview=city-runner');
  await expect(page.getByRole('heading', { name: 'City Runner 角色预览。' })).toBeVisible();
  const card = page.getByRole('button', { name: '查看 city-runner', exact: true });
  await expect(card).toHaveAttribute('data-asset-status', 'loaded');
  const observations = [];
  for (const [preset, label] of [['front', '正面'], ['back', '背面'], ['left', '左侧'], ['right', '右侧'], ['three-quarter', '45°']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction((preset) => window.__ASSET_PREVIEW__?.preset === preset && !!window.__ASSET_PREVIEW__.models['city-runner'], preset);
    const diagnostics = await page.evaluate(() => window.__ASSET_PREVIEW__);
    expect(Object.keys(diagnostics?.models ?? {})).toEqual(['city-runner']);
    expect(diagnostics?.models['city-runner']?.materials).toEqual([...character.materials].sort());
    expect(diagnostics?.models['city-runner']?.minY).toBeCloseTo(0, 4);
    character.dimensions.forEach((size: number, axis: number) => expect(diagnostics?.models['city-runner']?.size[axis]).toBeCloseTo(size, 4));
    expect(diagnostics?.triangles).toBeGreaterThan(character.triangles);
    expect(diagnostics?.light).toBe('neutral');
    const camera = diagnostics?.camera;
    if (!camera) throw new Error('Actual camera position missing');
    if (preset === 'front') { expect(Math.abs(camera[0] ?? 10)).toBeLessThan(.01); expect(camera[2]).toBeLessThan(-2); }
    if (preset === 'back') { expect(Math.abs(camera[0] ?? 10)).toBeLessThan(.01); expect(camera[2]).toBeGreaterThan(2); }
    if (preset === 'left') { expect(camera[0]).toBeLessThan(-2); expect(Math.abs(camera[2] ?? 10)).toBeLessThan(.01); }
    if (preset === 'right') { expect(camera[0]).toBeGreaterThan(2); expect(Math.abs(camera[2] ?? 10)).toBeLessThan(.01); }
    if (preset === 'three-quarter') { expect(camera[0]).toBeLessThan(-1); expect(camera[2]).toBeLessThan(-1); }
    expect(diagnostics?.jointMarkers).toEqual({});
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await page.locator('.asset-viewport').screenshot({ path: `${out}/character-${preset}.png` });
    observations.push({ preset, diagnostics });
  }
  for (const light of ['dusk-city', 'neon-city'] as const) {
    await page.getByLabel('角色光照').selectOption(light);
    await page.waitForFunction((light) => window.__ASSET_PREVIEW__?.light === light && !!window.__ASSET_PREVIEW__.models['city-runner'], light);
    await page.locator('.asset-viewport').screenshot({ path: `${out}/character-preview-${light}.png` });
  }
  await page.getByLabel('角色光照').selectOption('neutral');
  await page.getByLabel('关节参考').check();
  await page.waitForFunction(() => window.__ASSET_PREVIEW__?.joints === true && !!window.__ASSET_PREVIEW__.models['city-runner']);
  const markers = await page.evaluate(() => window.__ASSET_PREVIEW__?.jointMarkers);
  expect(Object.keys(markers ?? {}).sort()).toEqual(Object.keys(character.joints).sort());
  for (const [name, point] of Object.entries(character.joints)) {
    if (!Array.isArray(point)) throw new Error('Expected actual manifest joint reference');
    point.forEach((value: number, axis: number) => expect(markers?.[name]?.[axis]).toBeCloseTo(value, 4));
  }
  await page.locator('.asset-viewport').screenshot({ path: `${out}/character-joints.png` });
  const camera = await page.evaluate(() => window.__ASSET_PREVIEW__?.camera);
  const canvas = page.locator('.asset-viewport canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.evaluate(() => window.__ASSET_PREVIEW__?.camera)).not.toEqual(camera);
  const zoomed = await page.evaluate(() => window.__ASSET_PREVIEW__?.camera);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Character canvas missing');
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__ASSET_PREVIEW__?.camera)).not.toEqual(zoomed);
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__CITY_RENDER__' in window)).toBe(false);
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/character-preview-evidence.json`, JSON.stringify({ round, character, observations, errors }, null, 2));
  await page.goto('/?characterPreview=not-a-character');
  await expect(page.getByRole('alert')).toContainText('未知角色资源');
});

test('GLB character preserves real input, jump, slide, coin, collision and retry behavior', async ({ page }) => {
  const errors: string[] = [];
  let requests = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => { if (new URL(response.url()).pathname.endsWith('city-runner.glb')) { requests++; expect(response.ok()).toBe(true); } });
  await page.goto('/');
  await waitForThemeAssets(page);
  const model = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
  expect(model).toMatchObject({ models: 1, fallbacks: 0, visible: 1, jointMetadata: true, triangles: character.triangles });
  expect(model?.bounds?.minY).toBeCloseTo(0, 4);
  // The neutral preview above still checks the exact Rest dimensions. A formal
  // launch now starts Run, so compare its real CPU-skinned pose at the sampled
  // AnimationMixer phase instead of treating its bent knees as a scale defect.
  expect(model?.animation?.state).toBe('run');
  expect(model?.animation?.weights).toEqual({ idle: 0, run: 1, jump: 0, slide: 0 });
  expect(model?.scale).toEqual([1, 1, 1]);
  expect(model?.skinnedMeshes).toBe(character.skinnedMeshCount);
  expect(model?.skinCount).toBe(character.skinCount);
  expect(Object.keys(model?.bones ?? {})).toHaveLength(character.boneCount);
  const data = readFileSync(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene);
  try {
    const clip = gltf.animations.find(candidate => candidate.name === 'Run');
    if (!clip || !model?.animation || !model.bounds) throw new Error('Actual Run clip, phase and rendered bounds are required');
    const action = mixer.clipAction(clip).play();
    action.time = model.animation.time;
    mixer.update(0);
    const deformed = measureDeformed(gltf.scene);
    for (const axis of [0, 1, 2]) {
      const min = deformed.min[axis], max = deformed.max[axis], actual = model.bounds.size[axis];
      if (min === undefined || max === undefined || actual === undefined) throw new Error('Actual posed dimension missing');
      expect(Math.abs(actual - (max - min))).toBeLessThan(.005);
    }
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    gltf.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }
  expect(model?.materials).toHaveLength(character.materialCount);
  await startLiveGame(page);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_RENDER__?.character.position[0] ?? 0)).toBeLessThan(-2.7);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => Math.abs(window.__RUNNER_RENDER__?.character.position[0] ?? 10))).toBeLessThan(.02);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_RENDER__?.character.position[1] ?? 0), { intervals: [20] }).toBeGreaterThan(.2);
  await expect.poll(() => page.evaluate(() => window.__RUNNER_RENDER__?.character.position[1]), { intervals: [30] }).toBe(0);
  await page.keyboard.press('s');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_RENDER__?.character.bounds?.size[1] ?? 2), { intervals: [20] }).toBeLessThan(.83);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.scale[1])).toBe(1);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run' && window.__RUNNER_RENDER__.character.animation.weights.run === 1);
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0)).toBeGreaterThan(0);
  const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  const first = state?.entities.find((e) => e.kind !== 'coin' && e.distance > state.distance);
  if (!first || !state) throw new Error('Expected real seeded obstacle');
  for (let lane = state.player.lane; lane > first.lane; lane--) await page.keyboard.press('ArrowLeft');
  for (let lane = state.player.lane; lane < first.lane; lane++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 14000 });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().hit)).toBe(first.kind);
  await page.getByRole('button', { name: '再跑一次' }).click();
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 100)).toBeLessThan(5);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().coins)).toBe(0);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.models)).toBe(1);
  expect(requests).toBe(1);
  expect(errors).toEqual([]);
});

test('character appears in Dusk, Neon and both theme transitions at the gameplay camera', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await waitForThemeAssets(page);
  for (const [name, distance, theme] of [['dusk', 95, 'dusk-city'], ['transition', 630, 'neon-city'], ['neon', 780, 'neon-city'], ['return-transition', 1230, 'dusk-city']] as const) {
    const stats = await captureThemeAt(page, distance);
    expect(stats.themeId).toBe(theme);
    const model = await page.evaluate(() => window.__RUNNER_RENDER__?.character);
    expect(model).toMatchObject({ models: 1, fallbacks: 0, visible: 1, triangles: character.triangles });
    await page.locator('.game-stage').screenshot({ path: `${out}/character-game-${name}.png` });
  }
  expect(errors).toEqual([]);
});

test('character request failure reports the fallback and keeps collision/retry working', async ({ page }) => {
  const errors: string[] = [];
  const consoleErrors: { text: string; url: string }[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  await page.route((url) => url.pathname.endsWith('/models/generated/city-runner.glb'), (route) => route.abort('failed'));
  await page.goto('/');
  await requestGameScene(page);
  await expect(page.getByRole('status', { name: '角色资源状态' })).toContainText('City Runner 模型加载失败');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_RENDER__?.character.fallbacks)).toBe(1);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.character.models)).toBe(0);
  await page.getByRole('button', { name: '使用基础模型继续', exact: true }).click();
  await startLiveGame(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0)).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 12000 });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().hit)).toBe('hurdle');
  await page.getByRole('button', { name: '再跑一次' }).click();
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.filter((error) => !/^Could not load \/models\/generated\/city-runner\.glb\?v=[a-f0-9]{64}: Failed to fetch$/.test(error))).toEqual([]);
  writeFileSync('artifacts/ui-ux/regression/character-fallback-errors.json', JSON.stringify({ errors, consoleErrors, failedRequests }, null, 2));
  const expectedFailure = /Could not load \/models\/generated\/city-runner\.glb\?v=[a-f0-9]{64}: Failed to fetch/;
  expect(consoleErrors.some((message) => message.text.includes('[assets] city-runner:'))).toBe(true);
  expect(consoleErrors.filter((message) => !expectedFailure.test(message.text)
    && !(message.text.includes('Failed to load resource: net::ERR_FAILED') && /\/models\/generated\/city-runner\.glb\?v=[a-f0-9]{64}$/.test(message.url)))).toEqual([]);
  expect(failedRequests.length).toBeGreaterThan(0);
  expect(failedRequests.every((url) => /\/models\/generated\/city-runner\.glb\?v=[a-f0-9]{64}$/.test(url))).toBe(true);
});
