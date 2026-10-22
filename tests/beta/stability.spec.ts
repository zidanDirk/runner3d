import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { instrument, snapshot, settleHome, actualCollision, beginWallClockFrames } from './probe';
import { playTo } from '../e2e/progression-helpers';
const OUTPUT = 'artifacts/beta';
test('50 real settlement and page cycles retain bounded resources, followed by600s wall-clock active rendering', async ({ browser, baseURL }) => {
  test.setTimeout(900000); mkdirSync(OUTPUT, { recursive: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await instrument(context); const page = await context.newPage(); const cdp = await context.newCDPSession(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cycles: Awaited<ReturnType<typeof snapshot>>[] = []; const samples: unknown[] = [];
  const save = (complete: boolean) => writeFileSync(`${OUTPUT}/stability.json`, JSON.stringify({ complete, observedAt: new Date().toISOString(), scope: 'Desktop Chromium optimized E2E; no React Refresh.50 accelerated fixed-step actual deaths/nav cycles, then600s genuine wall-clock active RAF with existing lane-only autopilot. Not human/device/thermal/GPU-byte validation.', cycles, samples, errors }, null, 2));
  let complete = false;
  try {
    await page.goto('/'); await page.bringToFront(); await settleHome(page);
    for (let i = 0; i < 50; i++) {
      await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
      await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
      await page.evaluate(() => { window.__RUNNER_TEST__?.freeze(true); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await playTo(page, 95); expect((await actualCollision(page)).status).toBe('over');
      await expect(page.locator('[data-screen="results"]')).toBeVisible();
      await page.getByRole('button', { name: '升级商店', exact: true }).click(); await expect(page.getByRole('dialog', { name: '升级商店', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭成长面板', exact: true }).click(); await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await settleHome(page); const sample = await snapshot(page, cdp); cycles.push(sample); save(false);
      expect(sample.probe?.canvases).toBe(1); expect(sample.probe?.contexts.connected).toBe(1); expect(sample.probe?.contexts.retiredUnlost).toBe(0);
      expect(sample.lifecycle?.mixers.active).toBe(1); expect(sample.resourceOwnership?.owners).toBe(1); expect(sample.probe?.audio.live).toBe(1);
    }
    const warm = cycles[4], final = cycles.at(-1); if (!warm || !final) throw new Error('Missing50 cycle observations');
    expect(final.resourceOwnership).toEqual(warm.resourceOwnership);
    expect(final.heap.dom.eventListeners).toBeLessThanOrEqual(warm.heap.dom.eventListeners + 2);
    expect(final.heap.dom.nodes).toBeLessThanOrEqual(warm.heap.dom.nodes + 10);
    expect(final.heap.usedBytes).toBeLessThan(warm.heap.usedBytes + 8 * 1024 * 1024);
    expect(final.probe?.contexts.collected).toBeGreaterThanOrEqual((final.probe?.contexts.created ?? 0) - 2);
    await page.getByRole('button', { name: '开始奔跑', exact: true }).click(); await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
    await page.evaluate(() => { window.__RUNNER_TEST__?.autopilot(true); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await beginWallClockFrames(page);
    const start = Date.now(); const startTick = await page.evaluate(() => window.__RUNNER_TEST__?.read().tick ?? 0);
    for (let step = 0; step < 20; step++) {
      await page.waitForTimeout(Math.max(0, start + (step + 1) * 30000 - Date.now()));
      const sample = await snapshot(page, cdp); const telemetry = await page.evaluate(() => window.__BETA_MONITOR__?.());
      samples.push({ elapsedMs: Date.now() - start, sample, telemetry }); save(false);
      expect(sample.state?.status).toBe('running'); expect(sample.probe?.canvases).toBe(1); expect(sample.lifecycle?.mixers.active).toBe(1);
      expect(telemetry?.performance?.chunks).toBe(9); expect(sample.probe?.audio.live).toBe(1);
      expect(telemetry?.performance?.particles).toBeLessThanOrEqual(192); expect(sample.resourceOwnership?.owners).toBe(1);
      expect(telemetry?.performance?.gpuBytes).toBeNull();
      expect(telemetry?.analyticsCounts.GAME_READY).toBe(1); expect(telemetry?.analyticsCounts.APP_OPENED).toBe(1);
    }
    const elapsedMs = Date.now() - start; const end = await snapshot(page, cdp);
    const allFrames = await page.evaluate(() => { const frames = window.__BETA_WALL_FRAMES__?.read(); window.__BETA_WALL_FRAMES__?.stop(); return frames; });
    expect(elapsedMs).toBeGreaterThanOrEqual(600000); expect((end.state?.tick ?? 0) - startTick).toBeGreaterThan(60000);
    expect(errors).toEqual([]); complete = true; save(true);
    writeFileSync(`${OUTPUT}/wall-clock-summary.json`, JSON.stringify({ elapsedMs, allFrames, startTick, endTick: end.state?.tick, simulatedSeconds: ((end.state?.tick ?? 0) - startTick) / 120, cycles: cycles.length, browser: browser.version(), gpuBytes: null, result: 'passed' }, null, 2));
  } finally { save(complete); await cdp.detach(); await context.close(); }
});
