import { openGameSettings, closeGameSettings } from './session-helpers';
import { expect, test } from '@playwright/test';
import { applyMotionCase } from './motion-helpers';

test('landing feedback, camera, pause and reset remain visual and bounded', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?debugMotion=1');
  const landing = await applyMotionCase(page, 'landing');
  expect(landing.render?.character.impact.landing).toBeGreaterThan(.5);
  expect(landing.render?.character.impact.scaleY).toBeLessThan(1); expect(landing.player?.y).toBe(0);
  expect(landing.render?.character.position[1]).toBe(0); expect(landing.render?.character.soles?.left).toBeGreaterThan(-.011); expect(landing.render?.character.soles?.right).toBeGreaterThan(-.011);
  await expect(page.getByLabel('运动调试信息')).toContainText('FOV');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'paused');
  const paused = await page.evaluate(() => ({ camera: window.__RUNNER_RENDER__?.camera, character: window.__RUNNER_RENDER__?.character }));
  await page.waitForTimeout(220);
  const held = await page.evaluate(() => ({ camera: window.__RUNNER_RENDER__?.camera, character: window.__RUNNER_RENDER__?.character }));
  expect(held.camera).toEqual(paused.camera); expect(held.character?.impact).toEqual(paused.character?.impact); expect(held.character?.bones).toEqual(paused.character?.bones);
  await page.keyboard.press('Escape'); await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(30));
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.impact.scaleY === 1);
  const left = await applyMotionCase(page, 'lean-left'); expect(left.render?.character.lean).toBeGreaterThan(.08);
  expect(left.render?.camera.position[0]).toBeGreaterThan((left.player?.x ?? 0) * .12);
  const right = await applyMotionCase(page, 'lean-right'); expect(right.render?.character.lean).toBeLessThan(-.08);
  const fast = await applyMotionCase(page, 'fast-run'); expect(fast.speed).toBe(24); expect(fast.render?.camera.fov).toBe(55); expect(fast.render?.character.animation?.runScale).toBe(1.5);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '从头开始' }).click();
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.animation?.state === 'run');
  const reset = await page.evaluate(() => window.__RUNNER_RENDER__);
  expect(reset?.character.impact.scaleY).toBe(1); expect(Math.abs(reset?.character.lean ?? 1)).toBeLessThan(.01); expect(reset?.camera.fov).toBeLessThan(51.01);
  expect(errors).toEqual([]);
});

test('OS reduced motion and user override change visual response while preserving gameplay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await openGameSettings(page);
  const toggle = page.getByRole('checkbox', { name: '设置减少动态效果' }); await expect(toggle).toBeChecked();
  await closeGameSettings(page);
  const reduced = await applyMotionCase(page, 'fast-run'); expect(reduced.render?.camera.fov).toBe(51); expect(reduced.render?.camera.position[0]).toBe(0); expect(reduced.speed).toBe(24);
  const lean = await applyMotionCase(page, 'lean-left'); expect(Math.abs(lean.render?.character.lean ?? 1)).toBeLessThan(.07);
  const landing = await applyMotionCase(page, 'landing'); expect(landing.render?.character.impact.scaleY).toBe(1); expect(landing.player?.y).toBe(0);
  await openGameSettings(page); await toggle.uncheck(); await closeGameSettings(page, true); const full = await applyMotionCase(page, 'fast-run'); expect(full.render?.camera.fov).toBe(55);
  await page.reload(); await openGameSettings(page); await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: '动态效果跟随系统' }).click(); await expect(toggle).toBeChecked(); await closeGameSettings(page);
  await applyMotionCase(page, 'fast-run');
  const before = await page.evaluate(() => window.__RUNNER_TEST__?.read().distance);
  await openGameSettings(page); await toggle.uncheck(); await closeGameSettings(page, true); await page.waitForFunction(() => window.__RUNNER_RENDER__?.camera.fov === 55);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().distance)).toBe(before);
});

test('preview single step reports actual shoe geometry and pelvis, then resumes playback', async ({ page }) => {
  await page.goto('/?characterPreview=city-runner&animation=run&animationTime=.18');
  await page.waitForFunction(() => !!window.__ASSET_PREVIEW__?.footSoles && window.__ASSET_PREVIEW__.animation?.paused);
  const before = await page.evaluate(() => window.__ASSET_PREVIEW__?.bones);
  await page.getByRole('button', { name: '单步 +1/60秒' }).click();
  await page.waitForFunction(() => Math.abs((window.__ASSET_PREVIEW__?.animation?.time ?? 0) - (.18 + 1 / 60)) < .001);
  expect(await page.evaluate(() => window.__ASSET_PREVIEW__?.bones)).not.toEqual(before);
  await expect(page.getByTestId('preview-motion-data')).toContainText('鞋底Y');
  await page.getByLabel('动画播放速度').selectOption('1.5'); await page.getByRole('button', { name: '播放动画', exact: true }).click();
  await page.waitForFunction(() => window.__ASSET_PREVIEW__?.animation?.paused === false);
  expect(await page.evaluate(() => window.__ASSET_PREVIEW__?.footSoles?.left[1])).toBeGreaterThan(-.011);
});
