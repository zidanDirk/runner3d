import { startLiveGame } from './session-helpers';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForThemeAssets } from './theme-helpers';
export const FEEL_SEED = 'FEEL-09-194';
export const FEEL_INPUTS = [[360, 'Space'], [600, 'a'], [720, 's']] as const;
export async function settleFeedback(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
export async function prepareFeel(page: Page, seed = FEEL_SEED) {
  await page.goto('/'); await waitForThemeAssets(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await startLiveGame(page);
  await page.evaluate((seed) => window.__RUNNER_TEST__?.captureAt(seed, 0), seed);
  await settleFeedback(page);
  await page.waitForFunction(() => window.__FEEDBACK__?.audio.status === 'ready');
}
export async function stepFeelTo(page: Page, target: number) {
  let tick = await page.evaluate(() => window.__RUNNER_TEST__?.read().tick ?? -1);
  for (const [at, key] of FEEL_INPUTS) {
    if (at >= tick && at < target) {
      if (at > tick) await page.evaluate((n) => window.__RUNNER_TEST__?.stepTicks(n), at - tick);
      await page.keyboard.press(key); tick = at;
    }
  }
  if (target > tick) await page.evaluate((n) => window.__RUNNER_TEST__?.stepTicks(n), target - tick);
  await settleFeedback(page);
  const state = await page.evaluate(() => ({ tick: window.__RUNNER_TEST__?.read().tick, status: window.__RUNNER_TEST__?.read().status, effects: window.__FEEDBACK__ }));
  expect(state.effects).toBeTruthy(); return state;
}
