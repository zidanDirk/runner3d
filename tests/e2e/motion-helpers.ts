import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

export const MOTION_DEMO_SEED = 'MOTION-08-38';
export const MOTION_INPUTS = [[240, 'a'], [282, 'd'], [300, 'a'], [360, 'd'], [480, 'Space'], [720, 's']] as const;
export const MOTION_CASES = ['normal-run', 'fast-run', 'lean-left', 'lean-right', 'takeoff', 'air', 'landing', 'slide', 'dusk', 'neon'] as const;
export type MotionCase = typeof MOTION_CASES[number];
const ticks = { 'normal-run': 64, 'lean-left': 248, 'lean-right': 368, takeoff: 488, air: 536, landing: 600, slide: 744 } as const;

export async function stepMotionTo(page: Page, target: number) {
  let tick = await page.evaluate(() => window.__RUNNER_TEST__?.read().tick ?? -1);
  for (const [inputTick, key] of MOTION_INPUTS) {
    if (inputTick >= tick && inputTick < target) {
      if (inputTick > tick) await page.evaluate((count) => window.__RUNNER_TEST__?.stepTicks(count), inputTick - tick);
      await page.keyboard.press(key); tick = inputTick;
    }
  }
  if (target > tick) await page.evaluate((count) => window.__RUNNER_TEST__?.stepTicks(count), target - tick);
  await page.waitForFunction((target) => window.__RUNNER_RENDER__?.tick === target, target);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
export async function applyMotionCase(page: Page, name: MotionCase) {
  await waitForThemeAssets(page);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  if (name === 'dusk' || name === 'neon') await captureThemeAt(page, name === 'dusk' ? 95 : 780);
  else {
    await page.evaluate(({ seed, distance }) => window.__RUNNER_TEST__?.captureAt(seed, distance), { seed: MOTION_DEMO_SEED, distance: name === 'fast-run' ? 10000 : 0 });
    await page.waitForFunction(() => window.__RUNNER_RENDER__?.tick === window.__RUNNER_TEST__?.read().tick);
    if (name !== 'fast-run') for (let tick = 8; tick <= ticks[name]; tick += 8) await stepMotionTo(page, tick);
  }
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const result = await page.evaluate(() => ({ player: window.__RUNNER_TEST__?.read().player, speed: window.__RUNNER_TEST__?.read().speed, state: window.__RUNNER_TEST__?.read().status, render: window.__RUNNER_RENDER__ }));
  expect(result.state).toBe('running'); expect(result.render?.character.models).toBe(1);
  return result;
}
