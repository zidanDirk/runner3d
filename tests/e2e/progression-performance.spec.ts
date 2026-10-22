import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { startProgression, playTo } from './progression-helpers';
import { captureThemeAt } from './theme-helpers';
import type { Page } from '@playwright/test';
async function frames(page: Page, count: number) {
  return page.evaluate(count => new Promise<{ samples: number; meanMs: number; p95Ms: number; fps: number }>(resolve => {
    const times: number[] = []; let previous = 0;
    const frame = (time: number) => {
      if (previous) times.push(time - previous); previous = time;
      if (times.length < count) requestAnimationFrame(frame);
      else { const meanMs = times.reduce((a, b) => a + b, 0) / times.length; times.sort((a, b) => a - b); resolve({ samples: times.length, meanMs, p95Ms: times[Math.ceil(times.length * .95) - 1] ?? 0, fps: 1000 / meanMs }); }
    }; requestAnimationFrame(frame);
  }), count);
}
test('records growth-system draw budgets, real frames and bounded entities on all quality/theme combinations', async ({ browser }) => {
  test.setTimeout(180000); mkdirSync('artifacts/ui-ux/regression/progression', { recursive: true }); const results = [];
  for (const [name, width, height, dpr, level] of [['desktop-high', 1440, 900, 1, 'high'], ['mobile-medium', 390, 844, 3, 'medium'], ['mobile-low', 390, 844, 3, 'low']] as const) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: name !== 'desktop-high', isMobile: name !== 'desktop-high' });
    await context.addInitScript(level => localStorage.setItem('runner3d-quality-v1', level), level);
    const page = await context.newPage(); await startProgression(page);
    const cdp = await context.newCDPSession(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const fixed = [];
    for (const [theme, distance] of [['dusk', 95], ['transition', 630], ['neon', 780]] as const) {
      await captureThemeAt(page, distance); const frame = await frames(page, 90);
      const state = await page.evaluate(() => ({ render: window.__MOBILE_RENDER__, powerups: window.__RUNNER_RENDER__?.powerups, active: window.__RUNNER_TEST__?.read().powerups }));
      expect(state.render?.render.calls).toBeLessThan(230); expect(state.render?.city.chunks).toBe(9); expect(state.powerups?.pickups ?? 0).toBeLessThan(10);
      await cdp.send('HeapProfiler.collectGarbage'); const heap = await cdp.send('Runtime.getHeapUsage');
      fixed.push({ theme, distance, frame, ...state, heap: { ...heap, forcedGc: true } });
    }
    // Three naturally generated pickups in a fixed-seed real engine, followed by live rendering of their combined effects.
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '从头开始', exact: true }).click();
    await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('DEMO-11-4411', 0));
    await playTo(page, 270);
    const initialPowers = await page.evaluate(() => window.__RUNNER_TEST__?.read().powerups);
    expect(initialPowers?.magnet).toBeGreaterThan(0); expect(initialPowers?.shield).toBeGreaterThan(0); expect(initialPowers?.['double-score']).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.__RUNNER_TEST__?.read().tick ?? 0);
    await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
    const live = await frames(page, 180);
    await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
    const active = await page.evaluate(() => ({ state: window.__RUNNER_TEST__?.read(), render: window.__MOBILE_RENDER__, powers: window.__RUNNER_RENDER__?.powerups }));
    expect(active.state?.tick).toBeGreaterThan(before + 250); expect(active.state?.status).toBe('running');
    expect(active.render?.audio.activeContexts).toBeLessThanOrEqual(1); expect(active.render?.particles.active).toBeLessThanOrEqual(192);
    expect(errors).toEqual([]);
    results.push({ name, width, height, deviceDpr: dpr, level, fixed, live: { frames: live, fromTick: before, initialPowers, ...active } });
    await context.close();
  }
  writeFileSync('artifacts/ui-ux/regression/progression/performance.json', JSON.stringify({ host: { cpu: cpus()[0]?.model, platform: platform(), release: release(), browser: browser.version() }, mobile: 'Chromium emulation, not physical iOS/Android', pass: 'main scene completed pass; frozen90frames and separately real180frame play; forcedGC JS heap; no GPU bytes/timings available', results }, null, 2));
});
