import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { captureThemeAt } from './theme-helpers';
import { prepareFeel, settleFeedback } from './feel-helpers';

test('measures completed scene, 192-particle saturation and real active frames under the same three themes', async ({ page, context }) => {
  test.setTimeout(120000); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await prepareFeel(page); const cdp = await context.newCDPSession(page);
  const gpu = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unavailable'; });
  const sample = () => page.evaluate(() => new Promise<{ meanMs: number; p95Ms: number; fps: number; frames: number }>((resolve) => {
    const times: number[] = []; let previous = 0;
    const frame = (now: number) => { if (previous) times.push(now - previous); previous = now; if (times.length < 90) { requestAnimationFrame(frame); return; } const meanMs = times.reduce((a, b) => a + b, 0) / times.length; times.sort((a, b) => a - b); resolve({ meanMs, p95Ms: times[85] ?? 0, fps: 1000 / meanMs, frames: 90 }); }; requestAnimationFrame(frame);
  }));
  const heap = async () => { const forcedGc = await cdp.send('HeapProfiler.collectGarbage').then(() => true, () => false); return cdp.send('Runtime.getHeapUsage').then((v) => ({ usedBytes: v.usedSize, forcedGc }), () => null); };
  const scenes = [];
  for (const [name, distance] of [['dusk', 95], ['transition', 630], ['neon', 780]] as const) {
    await captureThemeAt(page, distance); const baselineFrames = await sample(); const baselineHeap = await heap();
    const baseline = await page.evaluate(() => ({ render: window.__RUNNER_RENDER__, feedback: window.__FEEDBACK__ }));
    expect(baseline.feedback?.particles).toBe(0);
    await page.evaluate(() => window.__RUNNER_TEST__?.stressEffects(80)); await settleFeedback(page);
    const saturated = await page.evaluate(() => ({ render: window.__RUNNER_RENDER__, feedback: window.__FEEDBACK__ }));
    expect(saturated.feedback?.particles).toBe(192); expect(saturated.feedback?.audio.activeVoices).toBeLessThanOrEqual(12);
    expect((saturated.render?.calls ?? Infinity) - (baseline.render?.calls ?? 0)).toBeLessThanOrEqual(2);
    expect((saturated.render?.triangles ?? Infinity) - (baseline.render?.triangles ?? 0)).toBeLessThanOrEqual(2500);
    const saturatedFrames = await sample(); const saturatedHeap = await heap();
    await captureThemeAt(page, distance);
    await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
    const liveFrames = await sample(); await page.evaluate(() => { window.__RUNNER_TEST__?.freeze(true); window.__RUNNER_TEST__?.autopilot(false); }); await settleFeedback(page);
    const live = await page.evaluate(() => ({ render: window.__RUNNER_RENDER__, feedback: window.__FEEDBACK__, status: window.__RUNNER_TEST__?.read().status }));
    expect(live.status).toBe('running'); expect(live.feedback?.peak).toBeLessThanOrEqual(192);
    scenes.push({ name, distance, baseline, baselineFrames, baselineHeap, saturated, saturatedFrames, saturatedHeap, live, liveFrames, liveHeap: await heap() });
  }
  writeFileSync('artifacts/feel-performance.json', JSON.stringify({ scope: '90 RAF intervals per case; main completed render pass. Saturation = explicit synthetic 80-fact pool stress, never claimed as actual game coin events. Live = real engine/autopilot route. No GPU timer available.', browser: 'Chromium', viewport: { width: 1440, height: 1000 }, gpu, scenes, errors }, null, 2));
  expect(errors).toEqual([]);
});

test('browser lifecycle stress reuses one context and returns voice/particle counts after repeated restarts and zone changes', async ({ page, context }) => {
  test.setTimeout(120000); await prepareFeel(page); const samples = [];
  const cdp = await context.newCDPSession(page);
  for (let cycle = 0; cycle < 24; cycle++) {
    await captureThemeAt(page, cycle % 2 ? 780 : 95);
    await page.evaluate(() => window.__RUNNER_TEST__?.stressEffects(40));
    await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(80)); await settleFeedback(page);
    expect(await page.evaluate(() => window.__FEEDBACK__?.audio.contextCount)).toBe(1);
    if (cycle % 6 === 0) { await cdp.send('HeapProfiler.collectGarbage'); samples.push({ cycle, heap: await cdp.send('Runtime.getHeapUsage'), feedback: await page.evaluate(() => window.__FEEDBACK__), render: await page.evaluate(() => ({ geometries: window.__RUNNER_RENDER__?.geometries, textures: window.__RUNNER_RENDER__?.textures })) }); }
  }
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('CLEANUP-09', 0)); await page.waitForTimeout(600); await settleFeedback(page);
  const end = await page.evaluate(() => window.__FEEDBACK__);
  expect(end?.particles).toBe(0); expect(end?.activeEffects).toBe(0); expect(end?.audio.activeVoices).toBe(0); expect(end?.audio.contextCount).toBe(1); expect(end?.audio.stateListenerCount).toBe(1);
  writeFileSync('artifacts/feel-lifecycle.json', JSON.stringify({ scope: '24 real rendered resets/zone swaps with synthetic visual/audio load; accelerated simulation is not a long-duration GPU leak proof', samples, end }, null, 2));
});
