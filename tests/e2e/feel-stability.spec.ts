import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { prepareFeel, settleFeedback } from './feel-helpers';

test('sixty seconds of real running crosses a zone while particle, audio and renderer ownership stay bounded', async ({ page, context }) => {
  test.setTimeout(90000); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await prepareFeel(page); await page.bringToFront(); const cdp = await context.newCDPSession(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
  const samples = []; const started = new Date().toISOString();
  for (let checkpoint = 1; checkpoint <= 4; checkpoint++) {
    await page.waitForTimeout(15000);
    const state = await page.evaluate(() => ({ distance: window.__RUNNER_TEST__?.read().distance, status: window.__RUNNER_TEST__?.read().status, tick: window.__RUNNER_TEST__?.read().tick, feedback: window.__FEEDBACK__, city: window.__CITY_RENDER__, render: { geometries: window.__RUNNER_RENDER__?.geometries, textures: window.__RUNNER_RENDER__?.textures } }));
    expect(state.status).toBe('running'); expect(state.feedback?.particles).toBeLessThanOrEqual(192); expect(state.feedback?.audio.activeVoices).toBeLessThanOrEqual(12); expect(state.feedback?.audio.contextCount).toBe(1); expect(state.city?.chunkIds).toHaveLength(9);
    await cdp.send('HeapProfiler.collectGarbage'); samples.push({ elapsedRequestedSeconds: checkpoint * 15, state, heapAfterGc: await cdp.send('Runtime.getHeapUsage') });
  }
  expect(samples.at(-1)?.state.distance).toBeGreaterThan(600);
  await page.keyboard.press('Escape'); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.activeVoices)).toBe(0);
  writeFileSync('artifacts/feel-stability.json', JSON.stringify({ scope: '60 wall-clock seconds of real RAF running under original autopilot input hook, four forced-GC samples. Does not establish long-term GPU leak freedom.', started, finished: new Date().toISOString(), samples, errors }, null, 2));
  expect(errors).toEqual([]);
});
