import { startLiveGame } from './session-helpers';
import { test, expect } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { FEEL_INPUTS, FEEL_SEED, prepareFeel, settleFeedback, stepFeelTo } from './feel-helpers';
import { waitForThemeAssets } from './theme-helpers';
import type { FeedbackEvent } from '../../src/feedback/types';

const output = 'artifacts/ui-ux/regression/feel-iteration/final';
test('captures twelve deterministic seconds of actual game facts and rendered feedback, including immediate death', async ({ page }) => {
  test.setTimeout(120000); mkdirSync(`${output}/frames`, { recursive: true });
  const errors: string[] = []; const timeline: FeedbackEvent[] = []; const frames = []; let deathTick = 0;
  page.on('pageerror', (error) => errors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await prepareFeel(page);
  let previousPost = 0;
  for (let frame = 0; frame <= 180; frame++) {
    const target = frame * 8;
    const state = await stepFeelTo(page, target);
    if (state.status === 'over' && !deathTick) deathTick = state.tick ?? 0;
    if (deathTick) {
      const post = Math.min(1.2, Math.max(0, (target - deathTick) / 120));
      await page.evaluate((dt) => window.__RUNNER_TEST__?.stepFeedback(dt), post - previousPost); previousPost = post;
      await settleFeedback(page);
    }
    const value = await page.evaluate(() => ({ tick: window.__RUNNER_TEST__?.read().tick, status: window.__RUNNER_TEST__?.read().status, distance: window.__RUNNER_TEST__?.read().distance, coins: window.__RUNNER_TEST__?.read().coins, player: window.__RUNNER_TEST__?.read().player, feedback: window.__FEEDBACK__, render: window.__RUNNER_RENDER__ }));
    expect(value.feedback?.particles).toBeLessThanOrEqual(192); expect(value.feedback?.audio.activeVoices).toBeLessThanOrEqual(12);
    expect(value.render?.character.models).toBe(1);
    for (const event of value.feedback?.recent ?? []) if (!timeline.some((old) => old.id === event.id)) timeline.push(event);
    await page.locator('.game-stage').screenshot({ path: `${output}/frames/${String(frame).padStart(3, '0')}.png` });
    frames.push({ frame, targetSeconds: target / 120, ...value });
  }
  expect(deathTick).toBeGreaterThan(1200); expect(deathTick).toBeLessThan(1350);
  for (const kind of ['coin', 'jump', 'land', 'lane', 'slide', 'collision', 'game-over']) expect(timeline.some((event) => event.type === kind)).toBe(true);
  expect(timeline.filter((event) => event.type === 'collision')).toHaveLength(1); expect(timeline.filter((event) => event.type === 'land')).toHaveLength(1);
  const collision = frames.find((frame) => frame.status === 'over'); expect(collision?.tick).toBe(deathTick);
  expect(frames.at(-1)?.feedback?.particles).toBe(0);
  for (const [name, index] of [['normal', 8], ['coin', 11], ['jump', 46], ['land', 60], ['lane', 77], ['slide', 93], ['collision', Math.ceil(deathTick / 8)], ['game-over', 179]] as const) copyFileSync(`${output}/frames/${String(index).padStart(3, '0')}.png`, `${output}/${name}.png`);
  writeFileSync(`${output}/timeline.json`, JSON.stringify({ source: 'actual fixed-step engine events; no injected physics or synthetic stress events', seed: FEEL_SEED, inputs: FEEL_INPUTS, viewport: { width: 1440, height: 1000 }, simulationStep: 1 / 120, duration: 12, capturedFrames: 181, deathTick, timeline, frames, errors }, null, 2));
  expect(errors).toEqual([]);
});

test('records actual unpaused RAF and trusted inputs for a continuous Game Feel video; video audio is reported separately', async ({ browser }) => {
  mkdirSync(`${output}/video`, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: `${output}/video`, size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(); const inputs = []; const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5174/'); await waitForThemeAssets(page);
  await startLiveGame(page);
  await page.evaluate((seed) => window.__RUNNER_TEST__?.captureAt(seed, 0), FEEL_SEED); await settleFeedback(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  for (const [tick, key] of FEEL_INPUTS) {
    await page.waitForFunction((tick) => (window.__RUNNER_TEST__?.read().tick ?? 0) >= tick, tick); await page.keyboard.press(key);
    inputs.push(await page.evaluate(({ tick, key }) => ({ requestedTick: tick, key, actualTick: window.__RUNNER_TEST__?.read().tick }), { tick, key }));
  }
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1250);
  const end = await page.evaluate(() => ({ tick: window.__RUNNER_TEST__?.read().tick, feedback: window.__FEEDBACK__, status: window.__RUNNER_TEST__?.read().status }));
  expect(end.status).toBe('over'); expect(end.feedback?.particles).toBe(0); expect(end.feedback?.audio.activeVoices).toBe(0);
  expect(end.feedback?.audio.contextCount).toBe(1); expect(end.feedback?.counts.collision).toBe(1);
  const video = page.video(); await context.close(); if (!video) throw new Error('Actual browser video unavailable');
  copyFileSync(await video.path(), `${output}/unpaused-feel.webm`);
  writeFileSync(`${output}/unpaused.json`, JSON.stringify({ source: 'real unpaused RAF + trusted Playwright keyboard input, actual input delivery recorded; video sound track must be inspected before audio-capture claims', seed: FEEL_SEED, inputs, end, errors }, null, 2));
  expect(errors).toEqual([]);
});
