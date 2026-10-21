import { startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';
import type { MobileMetrics } from '../../src/runtime/mobile-metrics';
import type { QualityLevel } from '../../src/quality/profiles';

const output = 'artifacts/mobile-iteration';
const baseURL = 'http://127.0.0.1:5174';

async function prepare(page: Page): Promise<void> {
  await page.goto('/'); await page.bringToFront(); await waitForThemeAssets(page);
  await startLiveGame(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 0));
  await page.waitForFunction(() => !!window.__MOBILE_RENDER__ && window.__MOBILE_RENDER__.audio.contextCount === 1);
}

async function readCompleted(page: Page): Promise<MobileMetrics> {
  await page.waitForFunction(() => window.__MOBILE_RENDER__?.game.tick === window.__RUNNER_TEST__?.read().tick && (window.__MOBILE_RENDER__?.render.calls ?? 0) > 0);
  const result = await page.evaluate(() => window.__MOBILE_RENDER__);
  if (!result) throw new Error('Completed mobile-render diagnostics missing');
  return result;
}

async function heap(cdp: CDPSession) {
  const forcedGc = await cdp.send('HeapProfiler.collectGarbage').then(() => true, () => false);
  return cdp.send('Runtime.getHeapUsage').then((value) => ({ usedBytes: value.usedSize, totalBytes: value.totalSize, forcedGc }), () => null);
}

async function listeners(cdp: CDPSession) {
  const inventory: Record<string, { total: number; byType: Record<string, number> } | null> = {};
  for (const [name, expression] of [['window', 'window'], ['document', 'document'], ['canvas', 'document.querySelector("canvas")'], ['stage', 'document.querySelector(".game-stage")']] as const) {
    try {
      const remote = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'mobile-listeners' });
      const objectId = remote.result.objectId;
      if (!objectId) { inventory[name] = null; continue; }
      const result = await cdp.send('DOMDebugger.getEventListeners', { objectId });
      const byType: Record<string, number> = {};
      for (const listener of result.listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1;
      inventory[name] = { total: result.listeners.length, byType };
    } catch { inventory[name] = null; }
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'mobile-listeners' }).catch(() => {});
  return inventory;
}

async function configure(context: BrowserContext, level: QualityLevel): Promise<void> {
  await context.addInitScript((level) => {
    localStorage.setItem('runner3d-quality-v1', level);
    localStorage.setItem('runner3d-reduced-motion-v1', 'false');
  }, level);
}

/** The test's fresh RAF sample is independent of the diagnostics' rolling window.
 * It is bounded to12000 intervals and reports whole sampling duration, not a
 * convenient final subset. Optional inputs use the normal keyboard adapter. */
async function sampleFrames(page: Page, durationMs: number, live: boolean) {
  return page.evaluate(({ durationMs, live }) => new Promise<{
    samples: number; durationMs: number; meanMs: number; p95Ms: number; p99Ms: number | null;
    fps: number; over33Ms: number; over50Ms: number; truncated: boolean;
    checkpoints: { elapsedMs: number; tick: number; distance: number; coins: number; themeId: string; particles: number; voices: number }[];
  }>((resolve) => {
    const intervals = new Float64Array(12000); let count = 0; let truncated = false;
    let start = 0; let previous = 0; let nextCheckpoint = 0; let jumped = false; let slid = false;
    const checkpoints: { elapsedMs: number; tick: number; distance: number; coins: number; themeId: string; particles: number; voices: number }[] = [];
    const frame = (now: number): void => {
      if (!start) start = now;
      if (previous) {
        if (count < intervals.length) intervals[count++] = now - previous; else truncated = true;
      }
      previous = now; const elapsed = now - start;
      if (live && elapsed > 2000 && !jumped) { jumped = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); }
      if (live && elapsed > 4000 && !slid) { slid = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown', bubbles: true })); }
      if (elapsed >= nextCheckpoint) {
        nextCheckpoint += 1000;
        const state = window.__RUNNER_TEST__?.read(); const metrics = window.__MOBILE_RENDER__;
        checkpoints.push({ elapsedMs: elapsed, tick: state?.tick ?? -1, distance: state?.distance ?? 0, coins: state?.coins ?? 0,
          themeId: metrics?.game.themeId ?? '', particles: metrics?.particles.active ?? 0, voices: metrics?.audio.activeVoices ?? 0 });
      }
      if (elapsed < durationMs) { requestAnimationFrame(frame); return; }
      const sorted = Array.from(intervals.subarray(0, count)).sort((a, b) => a - b);
      const measured = sorted.reduce((sum, value) => sum + value, 0); const meanMs = count ? measured / count : 0;
      resolve({ samples: count, durationMs: measured, meanMs, p95Ms: sorted[Math.ceil(count * .95) - 1] ?? 0,
        p99Ms: count >= 100 ? sorted[Math.ceil(count * .99) - 1] ?? null : null,
        fps: meanMs ? 1000 / meanMs : 0, over33Ms: sorted.filter((value) => value > 1000 / 30).length,
        over50Ms: sorted.filter((value) => value > 50).length, truncated, checkpoints });
    };
    requestAnimationFrame(frame);
  }), { durationMs, live });
}

test('records Desktop High and emulated Mobile Medium/Low with sixty seconds of real active rendering', async ({ browser }) => {
  test.setTimeout(180000); mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop-high', level: 'high', width: 1440, height: 900, deviceDpr: 1, mobile: false, liveMs: 10000 },
    { name: 'mobile-medium', level: 'medium', width: 390, height: 844, deviceDpr: 3, mobile: true, liveMs: 40000 },
    { name: 'mobile-low', level: 'low', width: 390, height: 844, deviceDpr: 3, mobile: true, liveMs: 10000 },
  ] as const;
  const reports = [];
  for (const item of cases) {
    const context = await browser.newContext({ baseURL, viewport: { width: item.width, height: item.height }, deviceScaleFactor: item.deviceDpr, hasTouch: item.mobile, isMobile: item.mobile });
    try {
      await configure(context, item.level); const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await prepare(page); const cdp = await context.newCDPSession(page);
      const fixed = [];
      for (const [name, distance] of [['dusk', 95], ['transition', 630], ['neon', 780]] as const) {
        await captureThemeAt(page, distance);
        const frames = await sampleFrames(page, 1500, false); const render = await readCompleted(page);
        expect(render.quality.profile.level).toBe(item.level);
        expect(render.dpr).toBeLessThanOrEqual(item.level === 'high' ? 1.5 : item.level === 'medium' ? 1.25 : 1);
        expect(render.drawingBuffer.width).toBe(Math.floor(render.viewport.canvasWidth * render.dpr));
        expect(render.drawingBuffer.height).toBe(Math.floor(render.viewport.canvasHeight * render.dpr));
        expect(render.city.chunks).toBe(9); expect(render.render.calls).toBeLessThan(230);
        expect(render.particles.capacity).toBe(192); expect(render.contextLost).toBe(false);
        for (const name of ['leftFoot', 'leftHead', 'rightFoot', 'rightHead', 'forwardHazard'] as const) {
          const point = render.camera.projections[name];
          expect(Math.abs(point[0]), `${item.name} ${name} horizontal reference`).toBeLessThan(1);
          expect(Math.abs(point[1]), `${item.name} ${name} vertical reference`).toBeLessThan(1);
          expect(Math.abs(point[2]), `${item.name} ${name} depth reference`).toBeLessThan(1);
        }
        const screenshot = `${output}/${item.name}-${name}.png`;
        await page.locator('.game-stage').screenshot({ path: screenshot });
        fixed.push({ name, distance, render, frames, heap: await heap(cdp), screenshot });
      }
      await captureThemeAt(page, 560);
      const start = await page.evaluate(() => {
        const hooks = window.__RUNNER_TEST__; if (!hooks) throw new Error('Capture hooks missing');
        const result = { tick: hooks.read().tick, distance: hooks.read().distance }; hooks.autopilot(true); return result;
      });
      const liveFrames = await sampleFrames(page, item.liveMs, true);
      const end = await page.evaluate(() => {
        const hooks = window.__RUNNER_TEST__; if (!hooks) throw new Error('Capture hooks missing');
        hooks.freeze(true); hooks.autopilot(false);
        const { tick, distance, status, coins } = hooks.read(); return { tick, distance, status, coins };
      });
      const liveRender = await readCompleted(page);
      expect(end.status).toBe('running'); expect(end.tick - start.tick).toBeGreaterThan(item.liveMs / 1000 * 100);
      expect(liveFrames.durationMs).toBeGreaterThanOrEqual(item.liveMs); expect(liveFrames.truncated).toBe(false);
      expect(liveFrames.checkpoints.every((value) => value.particles <= 192 && value.voices <= 12)).toBe(true);
      expect(liveRender.quality.mode).toBe(item.level); expect(liveRender.quality.profile.level).toBe(item.level);
      expect(errors).toEqual([]);
      reports.push({ ...item, emulation: item.mobile ? 'Playwright Chromium touch/viewport/DPR emulation on the desktop host; no physical phone' : 'Desktop Chromium on the same host',
        userAgent: await page.evaluate(() => navigator.userAgent), fixed, live: { start, end, frames: liveFrames, render: liveRender, heap: await heap(cdp) }, listeners: await listeners(cdp), errors });
    } finally { await context.close(); }
  }
  writeFileSync(`${output}/performance.json`, JSON.stringify({ startedBy: 'mobile-performance.spec.ts', finished: new Date().toISOString(),
    scope: 'Each fixed theme has a separate 1.5s frozen-frame sample; live cases are 10+40+10 seconds of real active RAF rendering, not accelerated simulation. Frame times are main-thread RAF intervals, not GPU timer results. These e2e samples include the existing character/scene diagnostic overhead. Different viewport/DPR/quality rows are different workloads and cannot prove a same-quality speedup.',
    host: { os: platform(), release: release(), cpu: cpus()[0]?.model ?? null, browser: browser.version() },
    requestedRealActiveMs: cases.reduce((sum, item) => sum + item.liveMs, 0), measuredRealActiveMs: reports.reduce((sum, item) => sum + item.live.frames.durationMs, 0), reports }, null, 2));
});

test('renders bounded lifecycle samples across ten minutes of accelerated normal-engine ticks', async ({ browser }) => {
  test.setTimeout(240000); mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  try {
    await configure(context, 'medium'); const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await prepare(page); const cdp = await context.newCDPSession(page);
    const initial = await readCompleted(page); const initialListeners = await listeners(cdp);
    const samples = []; const started = Date.now();
    //600 separate render commits, each following120 normal fixed ticks. Keyboard
    // intents follow the next row's safe lane exactly as the existing autopilot.
    // No engine state, velocity, entity, collision or score is injected.
    for (let second = 0; second < 600; second++) {
      const state = await page.evaluate(() => {
        const hooks = window.__RUNNER_TEST__; if (!hooks) throw new Error('Capture hooks missing');
        const command = (code: string): void => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); };
        for (let i = 0; i < 120; i++) {
          const view = hooks.read();
          if (view.status !== 'running') throw new Error(`Accelerated route stopped at tick${view.tick}, distance${view.distance}`);
          const row = view.rows.find((candidate) => candidate.distance >= view.distance - 2);
          if (view.distance > 35 && row && row.safeLane !== view.player.lane) command(row.safeLane < view.player.lane ? 'ArrowLeft' : 'ArrowRight');
          if (view.tick % 480 === 0) command('Space');
          if (view.tick % 480 === 240) command('ArrowDown');
          hooks.stepTicks(1);
        }
        const { tick, distance, coins, score, status } = hooks.read(); return { tick, distance, coins, score, status };
      });
      expect(state.tick).toBe((second + 1) * 120); expect(state.status).toBe('running');
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (second % 10 === 9) {
        const render = await readCompleted(page);
        expect(render.game.tick).toBe(state.tick); expect(render.city.chunks).toBe(9);
        expect(render.render.geometries).toBeLessThan(240); expect(render.render.sceneObjects).toBeLessThan(1200);
        expect(render.particles.active).toBeLessThanOrEqual(192); expect(render.audio.activeVoices).toBeLessThanOrEqual(12);
        expect(render.audio.contextCount).toBe(1); expect(render.audio.stateListenerCount).toBe(1);
        expect(render.frames.samples).toBeLessThanOrEqual(600);
        samples.push({ simulatedSeconds: second + 1, state, render, heap: await heap(cdp), listeners: second % 60 === 59 ? await listeners(cdp) : null });
      }
      if (second % 120 === 119) {
        await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'paused');
        const pausedTick = await page.evaluate(() => window.__RUNNER_TEST__?.read().tick);
        await page.waitForTimeout(60); expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().tick)).toBe(pausedTick);
        await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
      }
    }
    const longEnd = await readCompleted(page);
    expect(longEnd.game.tick).toBe(72000); expect(longEnd.game.distance).toBeGreaterThan(10000);
    expect(new Set(samples.map((sample) => sample.render.game.themeId)).size).toBe(2);
    expect(samples.at(-1)?.state.coins).toBeGreaterThan(0);
    const resets = [];
    for (let i = 0; i < 12; i++) {
      await page.evaluate((i) => window.__RUNNER_TEST__?.captureAt(`MOBILE-RESET-10-${i}`, i % 2 ? 780 : 95), i);
      await page.evaluate(() => window.__RUNNER_TEST__?.stressEffects(40));
      const render = await readCompleted(page);
      expect(render.city.chunks).toBe(9); expect(render.particles.active).toBeLessThanOrEqual(192);
      expect(render.audio.contextCount).toBe(1); expect(render.audio.activeVoices).toBeLessThanOrEqual(12);
      resets.push(render);
    }
    await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('MOBILE-CLEANUP-10', 0));
    await page.waitForTimeout(700); const end = await readCompleted(page); const finalListeners = await listeners(cdp);
    expect(end.particles.active).toBe(0); expect(end.audio.activeVoices).toBe(0); expect(end.audio.contextCount).toBe(1);
    for (const name of ['window', 'document', 'canvas', 'stage']) {
      const before = initialListeners[name]; const after = finalListeners[name];
      if (before && after) expect(after.total).toBeLessThanOrEqual(before.total + 2);
    }
    expect(errors).toEqual([]);
    writeFileSync(`${output}/stability.json`, JSON.stringify({ scope: '72000 normal fixed ticks =600 simulated seconds, with600 rendered commits, safe-lane keyboard intents, real generated coin/jump/slide facts and5 pause/resume cycles; then12 resets plus explicit synthetic effect stress. This is accelerated logic/lifecycle evidence, not ten minutes of real-time GPU or physical-phone testing. Audio sources end in wall time; accelerated events may be intentionally dropped by the12-source budget.',
      host: { os: platform(), release: release(), cpu: cpus()[0]?.model ?? null, browser: browser.version() },
      viewport: { width: 390, height: 844 }, deviceDpr: 3, quality: 'medium', elapsedWallMs: Date.now() - started,
      initial, initialListeners, samples, longEnd, resets, end, finalHeap: await heap(cdp), finalListeners, errors }, null, 2));
  } finally { await context.close(); }
});
