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

/** Preserve every 8-tick/two-frame visual checkpoint while avoiding per-tick
 * Playwright protocol round trips. Inputs still use the real keyboard bridge. */
export async function captureFeelTo(page: Page, target: number) {
  if (!Number.isSafeInteger(target) || target < 1 || target > 1350) throw new Error('Feel capture target must be 1..1350');
  const targets: number[] = [];
  for (let tick = 8; tick < target; tick += 8) targets.push(tick);
  targets.push(target);
  const inputs = FEEL_INPUTS.filter(([at]) => at < target);
  const boundaries = [...inputs.map(([at]) => at), target];
  let previous = 0;
  const checkpoints = [];
  for (const boundary of boundaries) {
    const samples = await page.evaluate(async ({ targets, initial }) => {
      const hooks = window.__RUNNER_TEST__;
      if (!hooks || (initial && hooks.read().tick !== 0)) throw new Error('Feel capture must start at tick zero');
      const samples = [];
      for (const target of targets) {
        const tick = hooks.read().tick;
        if (target > tick) hooks.stepTicks(target - tick);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        // A new task, like the original next evaluate, runs after all callbacks
        // in the completed render frame rather than inside their microtasks.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const effects = window.__FEEDBACK__;
        if (!effects) throw new Error(`Feedback missing at capture target ${target}`);
        samples.push({ target, tick: hooks.read().tick, status: hooks.read().status, particles: effects.particles, counts: effects.counts });
      }
      return samples;
    }, { targets: targets.filter(tick => tick > previous && tick <= boundary), initial: previous === 0 });
    checkpoints.push(...samples);
    const input = inputs.find(([at]) => at === boundary);
    if (input) await page.keyboard.press(input[1]);
    previous = boundary;
  }
  return checkpoints;
}
