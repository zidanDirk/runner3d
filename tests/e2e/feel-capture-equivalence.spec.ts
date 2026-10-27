import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { captureFeelTo, FEEL_SEED, prepareFeel, settleFeedback, stepFeelTo } from './feel-helpers';

// A separate migration proof, not a replacement for any of the 77 visual cases.
test('batched feedback capture preserves every original checkpoint and collision pixels', async ({ page }) => {
  test.setTimeout(120000);
  await prepareFeel(page);
  const original = [];
  const originalStart = performance.now();
  for (let target = 8; target <= 1350; target = Math.min(target + 8, 1350)) {
    const state = await stepFeelTo(page, target);
    original.push({ target, tick: state.tick, status: state.status, particles: state.effects?.particles, counts: state.effects?.counts });
    if (target === 1350) break;
  }
  const originalMs = performance.now() - originalStart;
  await page.evaluate(() => window.__RUNNER_TEST__?.stepFeedback(.08));
  await settleFeedback(page);
  const before = await page.locator('.game-stage').screenshot({ animations: 'disabled' });
  const originalGame = await page.evaluate(() => window.__RUNNER_TEST__?.read());

  await page.evaluate(seed => window.__RUNNER_TEST__?.captureAt(seed, 0), FEEL_SEED);
  await settleFeedback(page);
  const batchedStart = performance.now();
  const batched = await captureFeelTo(page, 1350);
  const batchedMs = performance.now() - batchedStart;
  expect(batched).toEqual(original);
  await page.evaluate(() => window.__RUNNER_TEST__?.stepFeedback(.08));
  await settleFeedback(page);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read())).toEqual(originalGame);
  const after = await page.locator('.game-stage').screenshot({ animations: 'disabled' });
  const output = 'artifacts/ci-visual-stability';
  mkdirSync(output, { recursive: true });
  writeFileSync(`${output}/collision-capture-equivalence.json`, JSON.stringify({
    scope: 'local real Chromium, original vs batched on the same page; not GitHub image compatibility',
    originalMs, batchedMs, originalEvaluateCalls: 676, batchedEvaluateCalls: 4,
    realKeyboardInputs: 3, checkpoints: batched.length, twoFrameSettles: batched.length,
    gameStateEqual: true, checkpointsEqual: true, screenshotBytesEqual: before.equals(after),
    checkpointsDetail: batched,
  }, null, 2) + '\n');
  writeFileSync(`${output}/collision-original.png`, before);
  writeFileSync(`${output}/collision-batched.png`, after);
  expect(after.equals(before)).toBe(true);
});
